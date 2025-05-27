import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { AudioBufferSourceNode, AudioContext } from 'react-native-audio-api';
import RnAudioBuffer from 'react-native-audio-api/lib/typescript/core/AudioBuffer';

const chevreImage = require('../assets/images/chevre_de_verzasca.jpg');

export default function GoatRnAudioApiScreen() {
  const [isLoading, setIsLoading] = useState(true);

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<RnAudioBuffer | null>(null);
  const playerNodeRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    const initAudio = async () => {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext();
        }
        const currentAudioContext = audioContextRef.current;

        if (!currentAudioContext) {
          console.error("AudioContext could not be initialized.");
          setIsLoading(false);
          return;
        }

        const uri = require('../assets/audio/chevre.mp3');

        if (!uri) {
          console.error('Failed to get audio asset URI.');
          setIsLoading(false);
          return;
        }

        const response = await fetch(uri);
        const arrayBuffer = await response.arrayBuffer();
        
        currentAudioContext.decodeAudioData(arrayBuffer)
          .then((decodedBuffer) => {
            audioBufferRef.current = decodedBuffer as RnAudioBuffer;
            setIsLoading(false);
          })
          .catch((err: DOMException | Error) => {
            console.error('Error decoding audio data:', err);
            setIsLoading(false);
          });
      } catch (error) {
        console.error("Failed to initialize audio:", error);
        setIsLoading(false);
      }
    };

    initAudio();

    return () => {
      const currentAudioContext = audioContextRef.current;
      if (currentAudioContext && 'state' in currentAudioContext && currentAudioContext.state !== 'closed') {
        // Standard Web Audio API close, check if react-native-audio-api supports it
        // currentAudioContext.close().catch(e => console.error("Error closing audio context", e));
      }
    };
  }, []);

  const meeeeh = async () => {
    const audioContext = audioContextRef.current;
    const audioBuffer = audioBufferRef.current;
    if (!audioContext || !audioBuffer || isLoading) {
      console.log('Audio not ready or still loading.');
      return;
    }

    try {
      if (playerNodeRef.current) {
        playerNodeRef.current.stop();
        playerNodeRef.current.disconnect();
      }

      playerNodeRef.current = await audioContext.createBufferSource({
        pitchCorrection: false,
      });
      playerNodeRef.current.buffer = audioBuffer;
      playerNodeRef.current.connect(audioContext.destination);
      playerNodeRef.current.start(audioContext.currentTime);
    } catch (error) {
      console.error("Failed to play sound:", error);
    }
  };

  return (
    <View className="flex-1 bg-black">
      <Pressable onPressIn={meeeeh} disabled={isLoading} className={`flex-1 ${isLoading ? 'opacity-50' : ''}`}>
        <Image
          source={chevreImage}
          className="w-full h-full active:scale-110 transition-transform duration-400 ease-in-out pointer-events-none select-none"
          contentFit="cover"
        />
      </Pressable>
    </View>
  );
}