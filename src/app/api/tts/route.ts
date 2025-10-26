// TODO:

// add different voices per person by adding voiceId (see reference_id below) in agent/scenarios
// add tones for specific agents by prefixing their emotion control to messages
//   ex for agent personality 'Adam', {name: 'Adam' personality: '(quiet) (sad)'} ---> message: (quiet) (sad) Blah blah blah
//   adding random yawning

import { NextRequest, NextResponse } from 'next/server';

const endpoint = process.env.TTS_ENDPOINT
const ttsEnabled = process.env.TTS_ENABLED

const headers = {
  'Authorization': 'Bearer ' + process.env.TTS_FISH_AUDIO_API_KEY,
  'Content-Type': 'application/json',
  'model': 's1'
}

export async function POST(request: NextRequest) {
  try {
    if (!ttsEnabled) {
      return NextResponse.json(
        { error: 'TTS is disabled' },
        { status: 500 }
      );
    }

    if (!endpoint) {
      return NextResponse.json(
        { error: 'TTS endpoint not configured' },
        { status: 500 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { text, agentName, voiceId } = body;

    if (!text) {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    // Prepare the request body for the external TTS API
    const ttsRequestBody = {
      "text": text,
      "format": "mp3",
      "reference_id": voiceId || "bf322df2096a46f18c579d0baa36f41d"
    }

    // Make request to external TTS API
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(ttsRequestBody),
    });

    if (!response.ok) {
      console.error(`TTS API error: ${response.status} ${response.statusText}`);
      return NextResponse.json(
        { error: `TTS API error: ${response.status}` },
        { status: response.status }
      );
    }

    // Get the audio blob from the TTS API
    const audioBlob = await response.blob();

    // Return the audio blob to the client
    return new NextResponse(audioBlob, {
      status: 200,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'audio/mpeg',
        'Content-Length': audioBlob.size.toString(),
      },
    });
  } catch (error) {
    console.error('Error in TTS API route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}