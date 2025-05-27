import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { AudioBufferSourceNode, AudioContext } from 'react-native-audio-api';
import RnAudioBuffer from 'react-native-audio-api/lib/typescript/core/AudioBuffer';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';

const chevreImage = require('../assets/images/chevre_de_verzasca.jpg');
const audioFileUri = require('../assets/audio/chevre.mp3');

export default function GoatRnAudioApiPitchScreen() {
  const [isLoading, setIsLoading] = useState(true);
  const [containerWidth, setContainerWidth] = useState(Dimensions.get('window').width);

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

        const response = await fetch(audioFileUri);
        const arrayBuffer = await response.arrayBuffer();
        
        currentAudioContext.decodeAudioData(arrayBuffer)
          .then((decodedBuffer) => {
            audioBufferRef.current = decodedBuffer as RnAudioBuffer;
            setIsLoading(false);
            console.log("Audio loaded successfully");
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
    return () => { /* Cleanup if needed */ };
  }, []);

  const calculatePlaybackRate = (locationX: number, width: number): number => {
    if (width === 0) return 1;
    const normalizedX = Math.max(0, Math.min(1, locationX / width));

    let rate;
    if (normalizedX < 0.5) {
      rate = normalizedX * 2;
    } else {
      rate = 1 + (normalizedX - 0.5) * 2;
    }
    return Math.max(0, Math.min(3, rate));
  };

  const panGesture = Gesture.Pan()
    .onBegin(async (event) => {
      const audioContext = audioContextRef.current;
      const audioBuffer = audioBufferRef.current;
      if (!audioContext || !audioBuffer || isLoading) return;

      try {
        if (playerNodeRef.current) {
          playerNodeRef.current.stop();
          playerNodeRef.current.disconnect();
        }
        
        const newPlayerNode = await audioContext.createBufferSource();
        newPlayerNode.buffer = audioBuffer;
        newPlayerNode.loop = true;
        
        const initialRate = calculatePlaybackRate(event.x, containerWidth);
        if (newPlayerNode.playbackRate) {
          newPlayerNode.playbackRate.value = initialRate;
        } else {
          console.warn('playbackRate not directly available on playerNode, might need specific handling for react-native-audio-api on this platform for rate changes.');
        }

        newPlayerNode.connect(audioContext.destination);
        newPlayerNode.start(audioContext.currentTime);
        playerNodeRef.current = newPlayerNode;
        console.log("Sound started. Rate:", initialRate);
      } catch (error) {
        console.error("Failed to start sound:", error);
      }
    })
    .onUpdate((event) => {
      if (playerNodeRef.current && playerNodeRef.current.playbackRate) {
        const newRate = calculatePlaybackRate(event.x, containerWidth);
        playerNodeRef.current.playbackRate.value = newRate;
      }
    })
    .onEnd(() => {
      console.log("onEnd");
      if (playerNodeRef.current) {
        try {
          playerNodeRef.current.stop();
          playerNodeRef.current.disconnect();
          console.log("Sound stopped.");
        } catch (error) {
          console.error("Failed to stop sound:", error);
        }
        playerNodeRef.current = null;
      }
    });

  return (
    <GestureHandlerRootView className="flex-1">
      <GestureDetector gesture={panGesture}>
        <View 
          className="flex-1" 
          onLayout={(event) => {
            const { width } = event.nativeEvent.layout;
            setContainerWidth(width);
          }}
        >
          <Image
            source={chevreImage}
            style={styles.imageStyle}
            className={`active:scale-110 transition-transform duration-400 ease-in-out pointer-events-none select-none ${isLoading ? 'opacity-50' : ''}`}
            contentFit="cover"
          />
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flexOne: {
    flex: 1,
  },
  imageStyle: {
    width: '100%',
    height: '100%',
  }
});