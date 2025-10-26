declare global {
    namespace NodeJS {
        interface ProcessEnv {
        TTS_ENDPOINT: string,
        TTS_FISH_AUDIO_API_KEY: string
        TTS_ENABLED: boolean
    }
}
}

  // If this file has no import/export statements (i.e. is a script)
  // convert it into a module by adding an empty export statement.
export {}