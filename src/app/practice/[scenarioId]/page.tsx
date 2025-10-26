"use client";

import { use, useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { getScenarioById, generateAgents } from '@/lib/scenarios';
import { generateAgentResponse, getResponseDelay, calculateScore, AgentPromptContext } from '@/lib/agent-responses';
import { ttsService } from '@/lib/tts-service';
import { Message, Agent, DifficultyLevel } from '@/types';
import { Mic, MicOff, Video, VideoOff, Phone, Clock, Users as UsersIcon, ArrowLeft, Settings, Check } from 'lucide-react';
import { formatTime } from '@/lib/utils';

interface PracticePageProps {
  params: Promise<{ scenarioId: string }>;
}

interface MediaDeviceInfo {
  deviceId: string;
  label: string;
}

export default function PracticePage({ params }: PracticePageProps) {
  const resolvedParams = use(params);
  const router = useRouter();
  const scenario = getScenarioById(resolvedParams.scenarioId);
  
  const [agents, setAgents] = useState<Agent[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('medium');
  const [sessionEnded, setSessionEnded] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState<string>('');
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState<string>('');
  const [customDurationSec, setCustomDurationSec] = useState<number | null>(null);
  const [userExtrasForContext, setUserExtrasForContext] = useState<string>('');
  const [talkingPointsForContext, setTalkingPointsForContext] = useState<Array<{ text: string; importance: number }>>([]);
  
  // TTS State - simplified to just enabled/disabled
  const [ttsEnabled, setTtsEnabled] = useState(() => {
    const saved = localStorage.getItem('tts-enabled');
    return saved ? JSON.parse(saved) : true;
  });
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const agentResponseTimers = useRef<NodeJS.Timeout[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  // Update TTS service when enabled state changes
  useEffect(() => {
    ttsService.setEnabled(ttsEnabled);
    localStorage.setItem('tts-enabled', JSON.stringify(ttsEnabled));
  }, [ttsEnabled]);

  // Load custom time limit from setup (if any)
  useEffect(() => {
    if (!scenario) return;
    try {
      const key = `practice-config-${scenario.id}`;
      const raw = localStorage.getItem(key);
      if (!raw) {
        setCustomDurationSec(null);
      } else {
        const parsed = JSON.parse(raw);
        const secs = Number(parsed?.timeLimitSeconds);
        if (Number.isFinite(secs) && secs >= 0) {
          setCustomDurationSec(secs);
        } else {
          setCustomDurationSec(null);
        }
        // Apply-once semantics so stale configs don't leak into future sessions
        localStorage.removeItem(key);
      }
    } catch {
      setCustomDurationSec(null);
    }
  }, [scenario]);

  // Load agent prompt context (user extras, talking points) from setup (ephemeral)
  useEffect(() => {
    if (!scenario) return;
    try {
      const ctxKey = `practice-context-${scenario.id}`;
      const rawCtx = localStorage.getItem(ctxKey);
      if (rawCtx) {
        const parsed = JSON.parse(rawCtx) as {
          userExtras?: string;
          talkingPoints?: Array<{ text: string; importance: number }>;
        };
        setUserExtrasForContext(parsed?.userExtras || '');
        setTalkingPointsForContext(
          Array.isArray(parsed?.talkingPoints) ? parsed!.talkingPoints!.slice(0, 20) : []
        );
        // one-time use to avoid leaking into future sessions
        localStorage.removeItem(ctxKey);
      }
    } catch {
      // ignore malformed context
    }
  }, [scenario]);

  // Enumerate media devices
  const enumerateDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      const videoInputs = devices
        .filter(device => device.kind === 'videoinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${device.deviceId.slice(0, 5)}`
        }));
      setVideoDevices(videoInputs);
      
      const audioInputs = devices
        .filter(device => device.kind === 'audioinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${device.deviceId.slice(0, 5)}`
        }));
      setAudioDevices(audioInputs);
      
      // Set default devices if none selected
      if (!selectedVideoDeviceId && videoInputs.length > 0) {
        setSelectedVideoDeviceId(videoInputs[0].deviceId);
      }
      if (!selectedAudioDeviceId && audioInputs.length > 0) {
        setSelectedAudioDeviceId(audioInputs[0].deviceId);
      }
    } catch (error) {
      console.error('Error enumerating devices:', error);
    }
  };

  // Initialize camera stream
  const startCamera = async (deviceId?: string) => {
    try {
      // Stop existing stream
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach(track => track.stop());
      }

      const constraints: MediaStreamConstraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoStreamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      setCameraError(null);
      
      // Enumerate devices after getting permission
      await enumerateDevices();
    } catch (error) {
      console.error('Error accessing camera:', error);
      setCameraError('Unable to access camera. Please check permissions.');
    }
  };

  // Initialize microphone stream
  const startMicrophone = async (deviceId?: string) => {
    try {
      // Stop existing stream
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(track => track.stop());
      }

      const constraints: MediaStreamConstraints = {
        video: false,
        audio: deviceId ? { deviceId: { exact: deviceId } } : true
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      audioStreamRef.current = stream;
      
      // Set initial mute state
      stream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
      });
      
      setMicError(null);
      
      // Enumerate devices after getting permission
      await enumerateDevices();
    } catch (error) {
      console.error('Error accessing microphone:', error);
      setMicError('Unable to access microphone. Please check permissions.');
    }
  };

  // Initial media setup
  useEffect(() => {
    if (isVideoOn) {
      startCamera();
    }
    startMicrophone();

    return () => {
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(track => track.stop());
      }
      // Stop all TTS audio on unmount
      ttsService.stopAll();
    };
  }, []);

  // Handle video toggle
  useEffect(() => {
    const toggleCamera = async () => {
      if (isVideoOn && !videoStreamRef.current) {
        await startCamera(selectedVideoDeviceId);
      } else if (!isVideoOn && videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach(track => track.stop());
        videoStreamRef.current = null;
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
      }
    };

    toggleCamera();
  }, [isVideoOn]);

  // Handle mute toggle
  useEffect(() => {
    if (audioStreamRef.current) {
      audioStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
      });
    }
  }, [isMuted]);

  // Handle video device change
  const handleVideoDeviceChange = async (deviceId: string) => {
    setSelectedVideoDeviceId(deviceId);
    if (isVideoOn) {
      await startCamera(deviceId);
    }
  };

  // Handle audio device change
  const handleAudioDeviceChange = async (deviceId: string) => {
    setSelectedAudioDeviceId(deviceId);
    await startMicrophone(deviceId);
  };

  useEffect(() => {
    if (!scenario) return;
    
    const generatedAgents = generateAgents(scenario);
    setAgents(generatedAgents);
    
    // Initial greeting from first agent
    setTimeout(() => {
      const welcomeMessage = generatedAgents[0].emotionPrefix 
        ? `${generatedAgents[0].emotionPrefix} Hello! Welcome to the session. Feel free to introduce yourself!`
        : "Hello! Welcome to the session. Feel free to introduce yourself!";
        
      addAgentMessage(generatedAgents[0], welcomeMessage);
    }, 2000);
  }, [scenario]);

  // Determine effective duration (0 means timer disabled)
  const effectiveDuration = (customDurationSec !== null ? customDurationSec : (scenario?.duration ?? 0));

  useEffect(() => {
    if (!isActive || sessionEnded) return;

    const timer = setInterval(() => {
      setTimeElapsed(prev => {
        const newTime = prev + 1;
        if (effectiveDuration > 0 && newTime >= effectiveDuration) {
          handleEndSession();
        }
        return newTime;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isActive, sessionEnded, effectiveDuration]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addAgentMessage = (agent: Agent, content: string) => {
    const newMessage: Message = {
      id: `msg-${Date.now()}-${Math.random()}`,
      agentId: agent.id,
      agentName: agent.name,
      content,
      timestamp: new Date(),
      isUser: false
    };
    setMessages(prev => [...prev, newMessage]);
    
    // Queue TTS for agent message
    if (ttsService.isEnabled()) {
      ttsService.queueSpeech({
        text: content,
        agentName: agent.name,
        messageId: newMessage.id,
        voiceId: agent.voiceId
      });
    }
  };

  const scheduleAgentResponse = () => {
    if (!scenario || agents.length === 0 || sessionEnded) return;
    
    const delay = getResponseDelay(difficulty);
    const randomAgent = agents[Math.floor(Math.random() * agents.length)];
    
    const timer = setTimeout(() => {
      const conversationHistory = messages.map(m => (m.isUser ? `You: ${m.content}` : `${m.agentName}: ${m.content}`));
      const ctx: AgentPromptContext = {
        scenarioBasePrompt: scenario.basePrompt,
        userExtras: userExtrasForContext,
        talkingPoints: talkingPointsForContext,
        presentational: scenario.presentational,
      };
      const response = generateAgentResponse(
        scenario.type,
        randomAgent,
        difficulty,
        conversationHistory,
        ctx
      );
      addAgentMessage(randomAgent, response);
      
      // Schedule next response
      scheduleAgentResponse();
    }, delay);
    
    agentResponseTimers.current.push(timer);
  };

  const handleSendMessage = () => {
    if (!userInput.trim()) return;
    
    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      agentId: 'user',
      agentName: 'You',
      content: userInput,
      timestamp: new Date(),
      isUser: true
    };
    
    setMessages(prev => [...prev, userMessage]);
    setUserInput('');
    
    // Trigger agent response after user message
    if (agents.length > 0 && !sessionEnded) {
      scheduleAgentResponse();
    }
  };

  const handleEndSession = () => {
    setIsActive(false);
    setSessionEnded(true);
    
    // Clear all pending agent responses
    agentResponseTimers.current.forEach(timer => clearTimeout(timer));
    agentResponseTimers.current = [];
    
    // Stop all media streams
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    // Stop all TTS audio
    ttsService.stopAll();
    
    // Calculate final score
    const userMessages = messages.filter(m => m.isUser).length;
    const score = calculateScore(userMessages, timeElapsed, difficulty);
    setFinalScore(score);
    
    // Save to localStorage
    const sessions = JSON.parse(localStorage.getItem('practice-sessions') || '[]');
    sessions.push({
      scenarioId: scenario?.id,
      date: new Date().toISOString(),
      score,
      duration: timeElapsed,
      difficulty
    });
    localStorage.setItem('practice-sessions', JSON.stringify(sessions));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (!scenario) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Scenario not found</h1>
          <Button onClick={() => router.push('/scenarios')}>
            Back to Scenarios
          </Button>
        </div>
      </div>
    );
  }

  if (sessionEnded) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h1 className="text-3xl font-bold mb-2">Session Complete!</h1>
          <p className="text-gray-600 mb-6">Great job practicing your public speaking skills</p>
          
          <div className="bg-blue-50 rounded-lg p-6 mb-6">
            <div className="text-5xl font-bold text-blue-600 mb-2">{finalScore}</div>
            <div className="text-sm text-gray-600">Your Score</div>
          </div>
          
          <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
            <div className="bg-gray-50 rounded p-3">
              <div className="font-semibold">{formatTime(timeElapsed)}</div>
              <div className="text-gray-600">Duration</div>
            </div>
            <div className="bg-gray-50 rounded p-3">
              <div className="font-semibold">{messages.filter(m => m.isUser).length}</div>
              <div className="text-gray-600">Your Messages</div>
            </div>
          </div>
          
          <div className="space-y-2">
            <Button className="w-full" onClick={() => router.push(`/practice/${scenario.id}`)}>
              Practice Again
            </Button>
            <Button variant="outline" className="w-full" onClick={() => router.push('/scenarios')}>
              Choose Another Scenario
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-900 flex flex-col">
      {/* Top Bar */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => router.push('/scenarios')}
            className="text-gray-300 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Exit
          </Button>
          <h1 className="text-white font-semibold">{scenario.title}</h1>
        </div>
        
        <div className="flex items-center space-x-6 text-gray-300 text-sm">
          <div className="flex items-center">
            <Clock className="w-4 h-4 mr-2" />
            {effectiveDuration > 0 ? (
              <>
                {formatTime(Math.max(0, effectiveDuration - timeElapsed))} left
              </>
            ) : (
              <>Timer off</>
            )}
          </div>
          <div className="flex items-center">
            <UsersIcon className="w-4 h-4 mr-2" />
            {agents.length + 1} participants
          </div>
          <div className="flex items-center px-3 py-1 bg-gray-700 rounded">
            <span className="text-xs font-medium">
              Difficulty: <span className="capitalize">{difficulty}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - User Video */}
        <div className="w-64 bg-gray-800 border-r border-gray-700 p-4">
          <div className="bg-gray-700 rounded-lg aspect-video mb-4 flex items-center justify-center relative overflow-hidden">
            {isVideoOn ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-cover"
                />
                {cameraError && (
                  <div className="absolute inset-0 bg-gray-800 flex items-center justify-center p-4">
                    <p className="text-red-400 text-xs text-center">{cameraError}</p>
                  </div>
                )}
              </>
            ) : (
              <div className="text-gray-500">Video Off</div>
            )}
            <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
              You
            </div>
            {!isMuted && audioStreamRef.current && (
              <div className="absolute top-2 right-2 bg-green-500 bg-opacity-80 text-white text-xs px-2 py-1 rounded flex items-center">
                <Mic className="w-3 h-3" />
              </div>
            )}
          </div>
          
          <div className="text-white text-sm font-medium mb-2">Controls</div>
          <div className="space-y-2">
            <Button
              variant={isMuted ? 'destructive' : 'outline'}
              size="sm"
              className="w-full justify-start"
              onClick={() => setIsMuted(!isMuted)}
            >
              {isMuted ? <MicOff className="w-4 h-4 mr-2" /> : <Mic className="w-4 h-4 mr-2" />}
              {isMuted ? 'Unmute' : 'Mute'}
            </Button>
            <Button
              variant={!isVideoOn ? 'destructive' : 'outline'}
              size="sm"
              className="w-full justify-start"
              onClick={() => setIsVideoOn(!isVideoOn)}
            >
              {isVideoOn ? <Video className="w-4 h-4 mr-2" /> : <VideoOff className="w-4 h-4 mr-2" />}
              {isVideoOn ? 'Stop Video' : 'Start Video'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => setShowSettings(true)}
            >
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="w-full justify-start"
              onClick={handleEndSession}
            >
              <Phone className="w-4 h-4 mr-2" />
              End Session
            </Button>
          </div>
          
          {micError && (
            <div className="mt-4 p-2 bg-red-900 bg-opacity-50 rounded text-xs text-red-300">
              {micError}
            </div>
          )}
        </div>

        {/* Center - Agent Videos */}
        <div className="flex-1 p-4 overflow-auto">
          <div className="grid grid-cols-2 gap-4 max-w-4xl mx-auto">
            {agents.map((agent) => (
              <div key={agent.id} className="bg-gray-700 rounded-lg aspect-video flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-green-500 to-teal-600 flex items-center justify-center">
                  <div className="text-white text-6xl">{agent.avatar}</div>
                </div>
                <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
                  {agent.name}
                </div>
                <div className="absolute top-2 right-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
                  {agent.personality}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Panel - Transcript */}
        <div className="w-96 bg-gray-800 border-l border-gray-700 flex flex-col">
          <div className="p-4 border-b border-gray-700">
            <h2 className="text-white font-semibold">Transcript</h2>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((message) => (
              <div key={message.id} className={`${message.isUser ? 'text-right' : 'text-left'}`}>
                <div className={`inline-block max-w-[80%] rounded-lg p-3 ${
                  message.isUser 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-700 text-gray-100'
                }`}>
                  <div className="font-semibold text-xs mb-1">
                    {message.agentName}
                  </div>
                  <div className="text-sm">{message.content}</div>
                  <div className="text-xs opacity-70 mt-1">
                    {message.timestamp.toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          
          <div className="p-4 border-t border-gray-700">
            <div className="flex space-x-2">
              <input
                type="text"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your message..."
                disabled={isMuted}
                className="flex-1 bg-gray-700 text-white rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
              <Button 
                onClick={handleSendMessage}
                disabled={!userInput.trim() || isMuted}
                size="sm"
              >
                Send
              </Button>
            </div>
            {isMuted && (
              <p className="text-xs text-yellow-500 mt-2">Unmute to send messages</p>
            )}
          </div>
        </div>
      </div>

      {/* Settings Dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Session Settings</DialogTitle>
            <DialogDescription>
              Customize your practice session preferences
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto pr-2">
            <div className="space-y-6 mt-4">
              {/* Session Settings Section */}
              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Session Settings</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-2 block">
                      Difficulty Level
                    </label>
                    <p className="text-xs text-gray-500 mb-3">
                      Controls how frequently AI agents respond during the session
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      {(['easy', 'medium', 'hard'] as DifficultyLevel[]).map((level) => (
                        <button
                          key={level}
                          onClick={() => setDifficulty(level)}
                          className={`px-4 py-3 rounded-lg border transition-colors ${
                            difficulty === level
                              ? 'border-blue-600 bg-blue-50 text-blue-700'
                              : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                          }`}
                        >
                          <div className="flex flex-col items-center">
                            <span className="text-sm font-medium capitalize">{level}</span>
                            <span className="text-xs text-gray-500 mt-1">
                              {level === 'easy' && '~8s delay'}
                              {level === 'medium' && '~5s delay'}
                              {level === 'hard' && '~3s delay'}
                            </span>
                            {difficulty === level && (
                              <Check className="w-4 h-4 text-blue-600 mt-1" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* TTS Settings Section */}
              <div className="border-t pt-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Text-to-Speech Settings</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="tts-enabled" className="text-sm font-medium">
                        Enable TTS for Agent Messages
                      </Label>
                      <p className="text-xs text-gray-500 mt-1">
                        AI agents will speak their messages using text-to-speech
                      </p>
                    </div>
                    <Switch
                      id="tts-enabled"
                      checked={ttsEnabled}
                      onCheckedChange={setTtsEnabled}
                    />
                  </div>
                  <p className="text-xs text-gray-500 bg-blue-50 p-3 rounded-lg">
                    <strong>Note:</strong> TTS configuration is managed through environment variables on the server. 
                    Contact your administrator to configure the TTS API endpoint and credentials.
                  </p>
                </div>
              </div>

              {/* Audio Settings Section */}
              <div className="border-t pt-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Audio Settings</h3>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    Microphone Source
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    Select which microphone to use for audio input
                  </p>
                  <div className="space-y-2">
                    {audioDevices.length === 0 ? (
                      <p className="text-sm text-gray-500 py-4 text-center bg-gray-50 rounded-lg">
                        No microphones detected
                      </p>
                    ) : (
                      audioDevices.map((device) => (
                        <button
                          key={device.deviceId}
                          onClick={() => handleAudioDeviceChange(device.deviceId)}
                          className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                            selectedAudioDeviceId === device.deviceId
                              ? 'border-blue-600 bg-blue-50'
                              : 'border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{device.label}</span>
                            {selectedAudioDeviceId === device.deviceId && (
                              <Check className="w-4 h-4 text-blue-600" />
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Video Settings Section */}
              <div className="border-t pt-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Video Settings</h3>
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    Camera Source
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    Select which camera to use for video
                  </p>
                  <div className="space-y-2">
                    {videoDevices.length === 0 ? (
                      <p className="text-sm text-gray-500 py-4 text-center bg-gray-50 rounded-lg">
                        No cameras detected
                      </p>
                    ) : (
                      videoDevices.map((device) => (
                        <button
                          key={device.deviceId}
                          onClick={() => handleVideoDeviceChange(device.deviceId)}
                          className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                            selectedVideoDeviceId === device.deviceId
                              ? 'border-blue-600 bg-blue-50'
                              : 'border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{device.label}</span>
                            {selectedVideoDeviceId === device.deviceId && (
                              <Check className="w-4 h-4 text-blue-600" />
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end mt-4 pt-4 border-t flex-shrink-0">
            <Button onClick={() => setShowSettings(false)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}