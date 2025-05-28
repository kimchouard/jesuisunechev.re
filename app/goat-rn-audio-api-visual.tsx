import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Dimensions, Pressable, View } from 'react-native';
import { AnalyserNode, AudioBufferSourceNode, AudioContext } from 'react-native-audio-api';
import RnAudioBuffer from 'react-native-audio-api/lib/typescript/core/AudioBuffer';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const chevreImage = require('../assets/images/chevre_de_verzasca.jpg');
const chevreSound = require('../assets/audio/chevre.mp3');
const ambientSound = require('../assets/audio/mountains-alps-loop.mp3');

const FFT_SIZE = 512;
const SCREEN_WIDTH = Dimensions.get('window').width;
const VISUALIZATION_HEIGHT = 300;
const FREQUENCY_BARS_COUNT = 20; // Number of frequency bars to display (adjustable)

export default function GoatAudioVisualScreen() {
  const [isLoading, setIsLoading] = useState(true);
  const [isGoatPlaying, setIsGoatPlaying] = useState(false);
  const [frequencyData, setFrequencyData] = useState<Uint8Array>(
    new Uint8Array(FFT_SIZE / 2).fill(0)
  );

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ambientBufferRef = useRef<RnAudioBuffer | null>(null);
  const goatBufferRef = useRef<RnAudioBuffer | null>(null);
  const ambientSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const goatSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Shared value for image scale animation
  const imageScale = useSharedValue(1);

  // Function to update frequency data
  const updateFrequencyData = () => {
    if (!analyserRef.current) return;

    const frequencyArrayLength = analyserRef.current.frequencyBinCount;
    const freqsArray = new Uint8Array(frequencyArrayLength);
    analyserRef.current.getByteFrequencyData(freqsArray);
    setFrequencyData(freqsArray);

    animationFrameRef.current = requestAnimationFrame(updateFrequencyData);
  };

  // Initialize audio context and load audio files
  useEffect(() => {
    const initAudio = async () => {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext();
        }
        const audioContext = audioContextRef.current;

        if (!audioContext) {
          console.error("AudioContext could not be initialized.");
          setIsLoading(false);
          return;
        }

        // Resume AudioContext if suspended
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }

        // Create analyser node
        if (!analyserRef.current) {
          analyserRef.current = await audioContext.createAnalyser();
          analyserRef.current.fftSize = FFT_SIZE;
          analyserRef.current.smoothingTimeConstant = 0.8;
          analyserRef.current.connect(audioContext.destination);
        }

        // Load ambient background audio
        const ambientResponse = await fetch(ambientSound);
        const ambientArrayBuffer = await ambientResponse.arrayBuffer();
        
        audioContext.decodeAudioData(ambientArrayBuffer)
          .then((decodedBuffer) => {
            ambientBufferRef.current = decodedBuffer as RnAudioBuffer;
            console.log("Ambient audio loaded");
          })
          .catch((err) => {
            console.error('Error decoding ambient audio:', err);
          });

        // Load goat sound
        const goatResponse = await fetch(chevreSound);
        const goatArrayBuffer = await goatResponse.arrayBuffer();
        
        audioContext.decodeAudioData(goatArrayBuffer)
          .then((decodedBuffer) => {
            goatBufferRef.current = decodedBuffer as RnAudioBuffer;
            console.log("Goat audio loaded");
            
            // Start ambient background loop after both are loaded
            setTimeout(() => {
              startAmbientLoop();
              setIsLoading(false);
            }, 500);
          })
          .catch((err) => {
            console.error('Error decoding goat audio:', err);
            setIsLoading(false);
          });

        console.log("Audio initialization started");
      } catch (error) {
        console.error("Failed to initialize audio:", error);
        setIsLoading(false);
      }
    };

    initAudio();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  const startAmbientLoop = async () => {
    if (!audioContextRef.current || !ambientBufferRef.current || !analyserRef.current) return;

    try {
      // Stop previous ambient source if exists
      if (ambientSourceRef.current) {
        ambientSourceRef.current.stop();
        ambientSourceRef.current.disconnect();
      }

      // Create new ambient source
      const ambientSource = await audioContextRef.current.createBufferSource();
      ambientSource.buffer = ambientBufferRef.current;
      ambientSource.loop = true;
      ambientSource.connect(analyserRef.current);
      ambientSource.start(audioContextRef.current.currentTime);
      ambientSourceRef.current = ambientSource;

      // Start frequency data updates
      updateFrequencyData();

      console.log("Ambient loop started");
    } catch (error) {
      console.error("Failed to start ambient loop:", error);
    }
  };

  const playGoatSound = async () => {
    if (!audioContextRef.current || !goatBufferRef.current || !analyserRef.current) return;

    try {
      // Stop previous goat sound if playing
      if (goatSourceRef.current) {
        goatSourceRef.current.stop();
        goatSourceRef.current.disconnect();
      }

      // Create new goat source
      const goatSource = await audioContextRef.current.createBufferSource();
      goatSource.buffer = goatBufferRef.current;
      goatSource.connect(analyserRef.current);
      
      // Handle when goat sound ends
      goatSource.onended = () => {
        setIsGoatPlaying(false);
        imageScale.value = withTiming(1, { duration: 200 });
      };

      goatSource.start(audioContextRef.current.currentTime);
      goatSourceRef.current = goatSource;
      setIsGoatPlaying(true);
      imageScale.value = withTiming(1.1, { duration: 200 });

      console.log("Goat sound played");
    } catch (error) {
      console.error("Failed to play goat sound:", error);
    }
  };

  // Animated style for image
  const animatedImageStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: imageScale.value }],
    };
  });

  // Frequency Visualization Component
  const FrequencyVisualization = () => {
    return (
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: VISUALIZATION_HEIGHT,
          flexDirection: 'row',
          alignItems: 'flex-end',
          paddingHorizontal: 2,
        }}
      >
        {Array.from({ length: Math.min(frequencyData.length, FREQUENCY_BARS_COUNT) }, (_, index) => {
          const value = frequencyData[index] || 0;
          const height = Math.max((value / 255) * VISUALIZATION_HEIGHT * 0.9, 1);
          
          // Create a more natural color palette that blends with mountain/nature imagery
          const normalizedIndex = index / FREQUENCY_BARS_COUNT;
          let hue, saturation, lightness;
          
          if (normalizedIndex < 0.3) {
            // Low frequencies: warm earth tones (browns, oranges)
            hue = 25 + normalizedIndex * 40; // 25-40 degrees (orange-brown)
            saturation = 60 + (value / 255) * 30; // 60-90%
            lightness = 40 + (value / 255) * 30; // 40-70%
          } else if (normalizedIndex < 0.7) {
            // Mid frequencies: green tones (forest/mountain colors)
            hue = 80 + normalizedIndex * 60; // 80-140 degrees (yellow-green to green)
            saturation = 50 + (value / 255) * 40; // 50-90%
            lightness = 35 + (value / 255) * 35; // 35-70%
          } else {
            // High frequencies: cool mountain/sky tones (blues, purples)
            hue = 200 + normalizedIndex * 80; // 200-280 degrees (blue to purple)
            saturation = 70 + (value / 255) * 20; // 70-90%
            lightness = 45 + (value / 255) * 25; // 45-70%
          }
          
          return (
            <Animated.View
              key={index}
              style={{
                width: (SCREEN_WIDTH - 4) / FREQUENCY_BARS_COUNT,
                height,
                backgroundColor: '#1B1B1F', //`hsla(${hue}, ${saturation}%, ${lightness}%, ${0.7 + (value / 255) * 0.3})`,
                borderRadius: 1,
                // shadowColor: '#1B1B1F', //`hsl(${hue}, ${saturation}%, ${lightness}%)`,
                // shadowOffset: { width: 0, height: -2 },
                // shadowOpacity: 0.3,
                // shadowRadius: 3,
              }}
            />
          );
        })}
      </View>
    );
  };

  return (
    <View className="flex-1 bg-black">
      <Pressable onPress={playGoatSound} className="flex-1" disabled={isLoading}>
        <Animated.View style={[{ flex: 1 }, animatedImageStyle]}>
          <Image
            source={chevreImage}
            className="w-full h-full pointer-events-none"
            contentFit="cover"
            style={{ opacity: isLoading ? 0.5 : 1 }}
          />
        </Animated.View>
      </Pressable>
      
      {/* Frequency Domain Visualization */}
      <FrequencyVisualization />
      
      {/* Loading indicator */}
      {isLoading && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
          }}
        >
          <Animated.Text style={{ color: 'white', fontSize: 16 }}>
            Loading Audio...
          </Animated.Text>
        </View>
      )}
    </View>
  );
}