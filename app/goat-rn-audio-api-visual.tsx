import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, Pressable, View } from 'react-native';
import { AnalyserNode, AudioBufferSourceNode, AudioContext } from 'react-native-audio-api';
import RnAudioBuffer from 'react-native-audio-api/lib/typescript/core/AudioBuffer';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated';

const chevreImage = require('../assets/images/chevre_de_verzasca.jpg');
const chevreSound = require('../assets/audio/chevre.mp3');
const ambientSound = require('../assets/audio/mountains-alps-loop.mp3');

// const BACKGROUND_COLOR = '#0B211C';
const BACKGROUND_COLOR = '#1B1B1F';

const FFT_SIZE = 512;
const SCREEN_WIDTH = Dimensions.get('window').width;
const VISUALIZATION_HEIGHT = 2500;
const FREQUENCY_BARS_COUNT = 30; // Number of frequency bars to display (adjustable)
// const FREQUENCY_BARS_COUNT = 100; // Number of frequency bars to display (adjustable)

// Visualization style options
const VISUALIZATION_TYPE: 'bars' | 'bars-rounded' | 'line' | 'area' = 'bars'; // Visualization type
const BAR_BORDER_RADIUS = 8; // Roundness of bars (0 = square, higher = more rounded)
const LINE_THICKNESS = 3; // Thickness of the line visualization
const SMOOTHING_FACTOR = 0.7; // How much to smooth the visualization (0-1, higher = smoother)
const MIRROR_VISUALIZATION = true; // Whether to mirror the visualization from center
const BAR_SPACING = -0.25; // Space between bars (0 = no space, higher = more space)
// const BAR_SPACING = 0.5;

export default function GoatAudioVisualScreen() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAmbientPlaying, setIsAmbientPlaying] = useState(false);
  const [screenSize, setScreenSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : Dimensions.get('window').width,
    height: typeof window !== 'undefined' ? window.innerHeight : Dimensions.get('window').height
  });
  const [frequencyData, setFrequencyData] = useState<Uint8Array>(
    new Uint8Array(FFT_SIZE / 2).fill(0)
  );
  const [smoothedFrequencyData, setSmoothedFrequencyData] = useState<number[]>(
    new Array(FREQUENCY_BARS_COUNT).fill(0)
  );

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ambientBufferRef = useRef<RnAudioBuffer | null>(null);
  const ambientSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Shared value for image scale animation
  const imageScale = useSharedValue(1);

  // Handle window resize for iframe compatibility
  useEffect(() => {
    const handleResize = () => {
      if (typeof window !== 'undefined') {
        setScreenSize({
          width: window.innerWidth,
          height: window.innerHeight
        });
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleResize);
      // Initial size check
      handleResize();
      
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }
  }, []);

  // Function to update frequency data
  const updateFrequencyData = () => {
    if (!analyserRef.current) return;

    const frequencyArrayLength = analyserRef.current.frequencyBinCount;
    const freqsArray = new Uint8Array(frequencyArrayLength);
    analyserRef.current.getByteFrequencyData(freqsArray);
    setFrequencyData(freqsArray);

    // Process and smooth the frequency data for visualization
    const newSmoothedData = new Array(FREQUENCY_BARS_COUNT);
    const binSize = Math.floor(frequencyArrayLength / FREQUENCY_BARS_COUNT);
    
    for (let i = 0; i < FREQUENCY_BARS_COUNT; i++) {
      // Average multiple frequency bins for each bar
      let sum = 0;
      const startBin = i * binSize;
      const endBin = Math.min(startBin + binSize, frequencyArrayLength);
      
      for (let j = startBin; j < endBin; j++) {
        sum += freqsArray[j];
      }
      
      const average = sum / (endBin - startBin);
      
      // Apply smoothing to reduce jitter
      const previousValue = smoothedFrequencyData[i] || 0;
      newSmoothedData[i] = previousValue * SMOOTHING_FACTOR + average * (1 - SMOOTHING_FACTOR);
    }
    
    setSmoothedFrequencyData(newSmoothedData);
    animationFrameRef.current = requestAnimationFrame(updateFrequencyData);
  };

  // Initialize audio context and load audio files
  useEffect(() => {
    const initAudio = async () => {
      try {
        // Wait a bit for iframe to be fully loaded
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext();
        }
        const audioContext = audioContextRef.current;

        if (!audioContext) {
          console.error("AudioContext could not be initialized.");
          setIsLoading(false);
          return;
        }

        console.log("AudioContext state:", audioContext.state);

        // Create analyser node
        if (!analyserRef.current) {
          analyserRef.current = await audioContext.createAnalyser();
          analyserRef.current.fftSize = FFT_SIZE;
          analyserRef.current.smoothingTimeConstant = 0.8;
          analyserRef.current.connect(audioContext.destination);
        }

        // Load ambient background audio
        try {
          const ambientResponse = await fetch(ambientSound);
          const ambientArrayBuffer = await ambientResponse.arrayBuffer();
          
          const decodedBuffer = await audioContext.decodeAudioData(ambientArrayBuffer);
          ambientBufferRef.current = decodedBuffer as RnAudioBuffer;
          console.log("Ambient audio loaded successfully");
        } catch (err) {
          console.error('Error loading ambient audio:', err);
        }

        // Load goat sound (keeping for compatibility)
        try {
          const goatResponse = await fetch(chevreSound);
          const goatArrayBuffer = await goatResponse.arrayBuffer();
          
          const decodedBuffer = await audioContext.decodeAudioData(goatArrayBuffer);
          console.log("Goat audio loaded successfully");
        } catch (err) {
          console.error('Error loading goat audio:', err);
        }

        setIsLoading(false);
        console.log("Audio initialization completed");
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
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, []);

  const toggleAmbientSound = async () => {
    if (!audioContextRef.current || !ambientBufferRef.current || !analyserRef.current) return;

    try {
      if (isAmbientPlaying) {
        // Stop ambient sound
        if (ambientSourceRef.current) {
          ambientSourceRef.current.stop();
          ambientSourceRef.current.disconnect();
          ambientSourceRef.current = null;
        }
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        
        // Reset visualization data to zero
        setFrequencyData(new Uint8Array(FFT_SIZE / 2).fill(0));
        setSmoothedFrequencyData(new Array(FREQUENCY_BARS_COUNT).fill(0));
        
        setIsAmbientPlaying(false);
        imageScale.value = withTiming(1, { duration: 200 });
        console.log("Ambient sound stopped");
      } else {
        // Resume AudioContext if suspended (important for iframe environments)
        if (audioContextRef.current.state === 'suspended') {
          console.log("Resuming suspended AudioContext...");
          await audioContextRef.current.resume();
        }
        
        // Start ambient sound
        const ambientSource = await audioContextRef.current.createBufferSource();
        ambientSource.buffer = ambientBufferRef.current;
        ambientSource.loop = true;
        ambientSource.connect(analyserRef.current);
        ambientSource.start(audioContextRef.current.currentTime);
        ambientSourceRef.current = ambientSource;

        // Start frequency data updates
        updateFrequencyData();
        
        setIsAmbientPlaying(true);
        imageScale.value = withTiming(1.1, { duration: 200 });
        console.log("Ambient sound started");
      }
    } catch (error) {
      console.error("Failed to toggle ambient sound:", error);
    }
  };

  const startAmbientLoop = async () => {
    // This function is now just for backwards compatibility
    await toggleAmbientSound();
  };

  // Animated style for image
  const animatedImageStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: imageScale.value }],
    };
  });

  // Frequency Visualization Component
  const FrequencyVisualization = () => {
    const getBarHeight = (value: number) => {
      // Use full height range - this was the issue!
      return Math.max((value / 255) * VISUALIZATION_HEIGHT, 2);
    };

    const renderBars = (rounded: boolean = false) => {
      return smoothedFrequencyData.map((value, index) => {
        const height = getBarHeight(value);
        const halfHeight = height / 2;
        const barWidth = (screenSize.width - 4) / FREQUENCY_BARS_COUNT - BAR_SPACING;
        const barLeft = index * ((screenSize.width - 4) / FREQUENCY_BARS_COUNT) + BAR_SPACING / 2;
        
        if (MIRROR_VISUALIZATION) {
          // Mirrored bars - top grows down, bottom grows up
          return (
            <React.Fragment key={index}>
              {/* Top half - grows downward from top of screen */}
              <Animated.View
                style={{
                  width: barWidth,
                  height: halfHeight,
                  backgroundColor: BACKGROUND_COLOR,
                  borderRadius: rounded ? BAR_BORDER_RADIUS : 0,
                  position: 'absolute',
                  left: barLeft,
                  top: 0, // Start from top of container
                }}
              />
              {/* Bottom half - grows upward from bottom of screen */}
              <Animated.View
                style={{
                  width: barWidth,
                  height: halfHeight,
                  backgroundColor: BACKGROUND_COLOR,
                  borderRadius: rounded ? BAR_BORDER_RADIUS : 0,
                  position: 'absolute',
                  left: barLeft,
                  bottom: 0, // Start from bottom of container
                }}
              />
            </React.Fragment>
          );
        } else {
          // Regular bars from bottom
          return (
            <Animated.View
              key={index}
              style={{
                width: barWidth,
                height,
                backgroundColor: BACKGROUND_COLOR,
                borderRadius: rounded ? BAR_BORDER_RADIUS : 0,
                marginHorizontal: BAR_SPACING / 2,
              }}
            />
          );
        }
      });
    };

    const renderLine = () => {
      return (
        <>
          {/* Connecting lines only - no dots */}
          {smoothedFrequencyData.slice(0, -1).map((value, index) => {
            const x1 = (index / (FREQUENCY_BARS_COUNT - 1)) * (screenSize.width - 4);
            const x2 = ((index + 1) / (FREQUENCY_BARS_COUNT - 1)) * (screenSize.width - 4);
            const height1 = getBarHeight(value);
            const height2 = getBarHeight(smoothedFrequencyData[index + 1]);
            
            if (MIRROR_VISUALIZATION) {
              // Top line - grows downward from top
              const y1Top = height1 / 2;
              const y2Top = height2 / 2;
              
              // Bottom line - grows upward from bottom
              const y1Bottom = VISUALIZATION_HEIGHT - height1 / 2;
              const y2Bottom = VISUALIZATION_HEIGHT - height2 / 2;
              
              const distanceTop = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2Top - y1Top, 2));
              const angleTop = Math.atan2(y2Top - y1Top, x2 - x1) * (180 / Math.PI);
              
              const distanceBottom = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2Bottom - y1Bottom, 2));
              const angleBottom = Math.atan2(y2Bottom - y1Bottom, x2 - x1) * (180 / Math.PI);
              
              return (
                <React.Fragment key={`line-${index}`}>
                  {/* Top connecting line */}
                  <Animated.View
                    style={{
                      position: 'absolute',
                      left: x1,
                      top: y1Top - LINE_THICKNESS / 2,
                      width: distanceTop,
                      height: LINE_THICKNESS,
                      backgroundColor: BACKGROUND_COLOR,
                      borderRadius: LINE_THICKNESS / 2,
                      transform: [{ rotate: `${angleTop}deg` }],
                      transformOrigin: 'left center',
                    }}
                  />
                  {/* Bottom connecting line */}
                  <Animated.View
                    style={{
                      position: 'absolute',
                      left: x1,
                      top: y1Bottom - LINE_THICKNESS / 2,
                      width: distanceBottom,
                      height: LINE_THICKNESS,
                      backgroundColor: BACKGROUND_COLOR,
                      borderRadius: LINE_THICKNESS / 2,
                      transform: [{ rotate: `${angleBottom}deg` }],
                      transformOrigin: 'left center',
                    }}
                  />
                </React.Fragment>
              );
            } else {
              const y1 = VISUALIZATION_HEIGHT - height1;
              const y2 = VISUALIZATION_HEIGHT - height2;
              const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
              const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
              
              return (
                <Animated.View
                  key={`line-${index}`}
                  style={{
                    position: 'absolute',
                    left: x1,
                    bottom: VISUALIZATION_HEIGHT - y1 - LINE_THICKNESS / 2,
                    width: distance,
                    height: LINE_THICKNESS,
                    backgroundColor: BACKGROUND_COLOR,
                    borderRadius: LINE_THICKNESS / 2,
                    transform: [{ rotate: `${angle}deg` }],
                    transformOrigin: 'left center',
                  }}
                />
              );
            }
          })}
        </>
      );
    };

    const renderArea = () => {
      return (
        <>
          {/* Area fill - full opacity */}
          {smoothedFrequencyData.map((value, index) => {
            const height = getBarHeight(value);
            const x = (index / FREQUENCY_BARS_COUNT) * (screenSize.width - 4);
            const width = (screenSize.width - 4) / FREQUENCY_BARS_COUNT;
            const halfHeight = height / 2;
            
            if (MIRROR_VISUALIZATION) {
              return (
                <React.Fragment key={`area-${index}`}>
                  {/* Top area - grows downward from top */}
                  <Animated.View
                    style={{
                      position: 'absolute',
                      left: x,
                      top: 0,
                      width,
                      height: halfHeight,
                      backgroundColor: BACKGROUND_COLOR, // Full opacity, same as line
                    }}
                  />
                  {/* Bottom area - grows upward from bottom */}
                  <Animated.View
                    style={{
                      position: 'absolute',
                      left: x,
                      bottom: 0,
                      width,
                      height: halfHeight,
                      backgroundColor: BACKGROUND_COLOR, // Full opacity, same as line
                    }}
                  />
                </React.Fragment>
              );
            } else {
              return (
                <Animated.View
                  key={`area-${index}`}
                  style={{
                    position: 'absolute',
                    left: x,
                    bottom: 0,
                    width,
                    height,
                    backgroundColor: BACKGROUND_COLOR, // Full opacity, same as line
                  }}
                />
              );
            }
          })}
          
          {/* Line on top of area */}
          {renderLine()}
        </>
      );
    };

    return (
      <View
        style={{
          position: 'absolute',
          top: 0, // Cover the entire screen height
          left: 0,
          right: 0,
          bottom: 0, // Cover the entire screen height
          flexDirection: VISUALIZATION_TYPE.startsWith('bars') ? 'row' : undefined,
          alignItems: VISUALIZATION_TYPE.startsWith('bars') && !MIRROR_VISUALIZATION ? 'flex-end' : undefined,
          paddingHorizontal: 2,
          pointerEvents: 'none', // Allow touches to pass through to the image
        }}
      >
        {VISUALIZATION_TYPE === 'bars' && renderBars(false)}
        {VISUALIZATION_TYPE === 'bars-rounded' && renderBars(true)}
        {VISUALIZATION_TYPE === 'line' && renderLine()}
        {VISUALIZATION_TYPE === 'area' && renderArea()}
      </View>
    );
  };

  return (
    <View className="flex-1 bg-black">
      <Pressable onPress={toggleAmbientSound} className="flex-1" disabled={isLoading}>
        <Animated.View style={[{ flex: 1 }, animatedImageStyle]}>
          <Image
            source={chevreImage}
            className="w-full h-full pointer-events-none select-none"
            contentFit="cover"
            style={{ opacity: isLoading ? 0.5 : 1 }}
          />
        </Animated.View>
      </Pressable>
      
      {/* Frequency Domain Visualization */}
      {isAmbientPlaying && <FrequencyVisualization />}
      
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
      
      {/* Play/Pause indicator */}
      {/* {!isLoading && (
        <View
          style={{
            position: 'absolute',
            top: 50,
            right: 20,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            borderRadius: 20,
            paddingHorizontal: 12,
            paddingVertical: 6,
          }}
        >
          <Animated.Text style={{ color: 'white', fontSize: 14 }}>
            {isAmbientPlaying ? '⏸️ Tap to Pause' : '▶️ Tap to Play'}
          </Animated.Text>
        </View>
      )} */}
    </View>
  );
}