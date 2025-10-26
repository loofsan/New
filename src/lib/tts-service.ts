export interface TTSRequest {
  text: string;
  agentName: string;
  messageId: string;
  voiceId?: string;
}

export interface TTSQueueItem {
  audio: HTMLAudioElement;
  messageId: string;
  agentName: string;
}

class TTSService {
  private audioQueue: TTSQueueItem[] = [];
  private isPlaying: boolean = false;
  private currentAudio: HTMLAudioElement | null = null;
  private enabled: boolean = true;

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async generateSpeech(request: TTSRequest): Promise<HTMLAudioElement | null> {
    if (!this.enabled) {
      console.log('TTS is disabled');
      return null;
    }

    try {
      // Call our backend API instead of external API
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: request.text,
          agentName: request.agentName,
          voiceId: request.voiceId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `TTS API error: ${response.status}`);
      }

      // Get the audio blob from our backend
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      const audio = new Audio(audioUrl);
      
      // Clean up the blob URL when audio finishes playing
      audio.addEventListener('ended', () => {
        URL.revokeObjectURL(audioUrl);
      });

      return audio;
    } catch (error) {
      console.error('Error generating speech:', error);
      return null;
    }
  }

  async queueSpeech(request: TTSRequest): Promise<void> {
    const audio = await this.generateSpeech(request);
    
    if (!audio) {
      return;
    }

    const queueItem: TTSQueueItem = {
      audio,
      messageId: request.messageId,
      agentName: request.agentName,
    };

    this.audioQueue.push(queueItem);

    // Start playing if not already playing
    if (!this.isPlaying) {
      this.playNext();
    }
  }

  private playNext(): void {
    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      this.currentAudio = null;
      return;
    }

    this.isPlaying = true;
    const queueItem = this.audioQueue.shift()!;
    this.currentAudio = queueItem.audio;

    console.log(`Playing TTS for ${queueItem.agentName}: ${queueItem.messageId}`);

    // Set up event listeners
    queueItem.audio.addEventListener('ended', () => {
      this.playNext();
    });

    queueItem.audio.addEventListener('error', (error) => {
      console.error('Error playing audio:', error);
      this.playNext();
    });

    // Start playback
    queueItem.audio.play().catch((error) => {
      console.error('Error starting audio playback:', error);
      this.playNext();
    });
  }

  stopAll(): void {
    // Stop current audio
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }

    // Clear queue and clean up audio elements
    this.audioQueue.forEach(item => {
      item.audio.pause();
      item.audio.src = '';
    });
    
    this.audioQueue = [];
    this.isPlaying = false;
  }

  skipCurrent(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.playNext();
    }
  }

  getQueueLength(): number {
    return this.audioQueue.length;
  }

  isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }
}

// Export singleton instance
export const ttsService = new TTSService();