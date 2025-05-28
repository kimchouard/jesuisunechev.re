import { Image as ExpoImage } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { AudioBufferSourceNode, AudioContext, GainNode, OscillatorNode } from 'react-native-audio-api';
import RnAudioBuffer from 'react-native-audio-api/lib/typescript/core/AudioBuffer';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming
} from 'react-native-reanimated';

const chevreImage = require('../assets/images/chevre_de_verzasca.jpg');
const audioFileUri = require('../assets/audio/chevre.mp3');

const MAX_ROTATE_Y_DEGREES = 45; // Max rotation angle around Y axis
const MAX_ROTATE_X_DEGREES = 30; // Max rotation angle around X axis

// LFO parameters for volume modulation
const LFO_MIN_FREQ = 0.5; // Min LFO frequency (Hz)
const LFO_MAX_FREQ = 10;   // Max LFO frequency (Hz)
const LFO_MIN_DEPTH = 0;  // Min LFO depth (no effect at center)
const LFO_MAX_DEPTH = 1; // Max LFO depth (40% volume modulation at top)

// Create an animatable version of ExpoImage
const AnimatedImage = Animated.createAnimatedComponent(ExpoImage);

export default function GoatRnAudioApiPitchScreen() {
  const [isLoading, setIsLoading] = useState(true);
  const [containerSize, setContainerSize] = useState({ 
    width: Dimensions.get('window').width, 
    height: Dimensions.get('window').height 
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<RnAudioBuffer | null>(null);
  const playerNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const mainGainNodeRef = useRef<GainNode | null>(null);
  const lfoNodeRef = useRef<OscillatorNode | null>(null);
  const lfoGainNodeRef = useRef<GainNode | null>(null);

  // Reanimated shared values for both X and Y
  const gestureX = useSharedValue(0);
  const gestureY = useSharedValue(0);
  const isActive = useSharedValue(false);
  const interactionScale = useSharedValue(1); // Shared value for interaction scale

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

  // Calculate normalized Y position (-1 to 1, where 0 is center)
  const getNormalizedYCentered = (locationY: number, height: number): number => {
    if (height === 0) return 0;
    return ((height - locationY) / height) * 2 - 1; 
  };

  // Calculate LFO parameters based on Y position (upper half only)
  const calculateLFOParams = (normalizedY: number) => {
    if (normalizedY <= 0) {
      // Lower half or center - no LFO effect
      return { frequency: LFO_MIN_FREQ, depth: LFO_MIN_DEPTH };
    }
    
    // Upper half - scale from 0 to 1
    const intensity = normalizedY; // 0 at center, 1 at top
    const frequency = LFO_MIN_FREQ + (intensity * (LFO_MAX_FREQ - LFO_MIN_FREQ));
    const depth = LFO_MIN_DEPTH + (intensity * (LFO_MAX_DEPTH - LFO_MIN_DEPTH));
    
    return { frequency, depth };
  };

  const panGesture = Gesture.Pan()
    .onBegin(async (event) => {
      isActive.value = true;
      interactionScale.value = withTiming(0.9, { duration: 200 }); // Scale down on press
      gestureX.value = event.x; // Store initial X for animation reference if needed
      gestureY.value = event.y; // Store initial Y for animation reference
      console.log("[Gesture] onBegin", event.state);
      const audioContext = audioContextRef.current;
      const audioBuffer = audioBufferRef.current;
      if (!audioContext || !audioBuffer || isLoading) {
        console.log("[Gesture] Audio not ready or still loading onBegin.");
        return;
      }

      try {
        // Clean up previous nodes
        if (playerNodeRef.current) {
          playerNodeRef.current.stop();
          playerNodeRef.current.disconnect();
        }
        if (lfoNodeRef.current) {
          lfoNodeRef.current.stop();
          lfoNodeRef.current.disconnect();
        }
        if (mainGainNodeRef.current) {
          mainGainNodeRef.current.disconnect();
        }
        if (lfoGainNodeRef.current) {
          lfoGainNodeRef.current.disconnect();
        }
        
        // Create audio nodes
        const newPlayerNode = await audioContext.createBufferSource();
        newPlayerNode.buffer = audioBuffer;
        newPlayerNode.loop = true;
        
        const mainGain = await audioContext.createGain();
        mainGain.gain.value = 0.7; // Base volume
        
        const lfoNode = await audioContext.createOscillator();
        lfoNode.type = 'sine';
        
        const lfoGain = await audioContext.createGain();
        
        // Set initial playback rate based on X position
        const initialRate = calculatePlaybackRate(event.x, containerSize.width);
        if (newPlayerNode.playbackRate) {
          newPlayerNode.playbackRate.value = initialRate;
        }
        
        // Set initial LFO parameters based on Y position
        const normalizedY = getNormalizedYCentered(event.y, containerSize.height);
        const lfoParams = calculateLFOParams(normalizedY);
        lfoNode.frequency.value = lfoParams.frequency;
        lfoGain.gain.value = lfoParams.depth;
        
        // Connect the audio graph
        newPlayerNode.connect(mainGain);
        mainGain.connect(audioContext.destination);
        
        // Connect LFO to main gain for volume modulation (only if there's depth)
        if (lfoParams.depth > 0) {
          lfoNode.connect(lfoGain);
          lfoGain.connect(mainGain);
        }
        
        // Store references
        playerNodeRef.current = newPlayerNode;
        mainGainNodeRef.current = mainGain;
        lfoNodeRef.current = lfoNode;
        lfoGainNodeRef.current = lfoGain;
        
        // Start audio
        lfoNode.start(audioContext.currentTime);
        newPlayerNode.start(audioContext.currentTime);
        
        console.log("[Gesture] Sound started. Rate:", initialRate, "LFO:", lfoParams);
      } catch (error) {
        console.error("[Gesture] Failed to start sound:", error);
      }
    })
    .onStart((event) => {
      console.log("[Gesture] onStart", event.state);
    })
    .onUpdate((event) => {
      if(isActive.value) {
        gestureX.value = event.x;
        gestureY.value = event.y;
      }
      
      // Update playback rate based on X position
      if (playerNodeRef.current && playerNodeRef.current.playbackRate) {
        const newRate = calculatePlaybackRate(event.x, containerSize.width);
        playerNodeRef.current.playbackRate.value = newRate;
      }
      
      // Update LFO parameters based on Y position
      if (lfoNodeRef.current && lfoGainNodeRef.current) {
        const normalizedY = getNormalizedYCentered(event.y, containerSize.height);
        const lfoParams = calculateLFOParams(normalizedY);
        
        lfoNodeRef.current.frequency.value = lfoParams.frequency;
        lfoGainNodeRef.current.gain.value = lfoParams.depth;
        
        // Handle LFO connection/disconnection based on depth
        if (lfoParams.depth > 0 && mainGainNodeRef.current) {
          // Ensure LFO is connected (this is safe to call multiple times)
          try {
            lfoNodeRef.current.connect(lfoGainNodeRef.current);
            lfoGainNodeRef.current.connect(mainGainNodeRef.current.gain);
          } catch (e) {
            // Already connected, ignore
          }
        }
      }
    })
    .onEnd((event) => {
      console.log("[Gesture] onEnd - State:", event.state);
    })
    .onFinalize((event, success) => {
      isActive.value = false;
      interactionScale.value = withTiming(1, { duration: 200 }); // Scale back to normal
      gestureX.value = withSpring(containerSize.width / 2, { damping: 15, stiffness:120 }); // Animate X back to center
      gestureY.value = withSpring(containerSize.height / 2, { damping: 15, stiffness:120 }); // Animate Y back to center
      console.log(`[Gesture] onFinalize - Success: ${success}, State: ${event.state}`);
      
      // Clean up all audio nodes
      if (playerNodeRef.current) {
        try {
          console.log("[Gesture] Stopping sound via onFinalize...");
          playerNodeRef.current.stop();
          playerNodeRef.current.disconnect();
          playerNodeRef.current = null;
        } catch (error) {
          console.error("[Gesture] Failed to stop player node:", error);
        }
      }
      
      if (lfoNodeRef.current) {
        try {
          lfoNodeRef.current.stop();
          lfoNodeRef.current.disconnect();
          lfoNodeRef.current = null;
        } catch (error) {
          console.error("[Gesture] Failed to stop LFO node:", error);
        }
      }
      
      if (mainGainNodeRef.current) {
        mainGainNodeRef.current.disconnect();
        mainGainNodeRef.current = null;
      }
      
      if (lfoGainNodeRef.current) {
        lfoGainNodeRef.current.disconnect();
        lfoGainNodeRef.current = null;
      }
      
      console.log("[Gesture] All audio nodes stopped and disconnected.");
    });

  // Animated style for the image with both X and Y rotations
  const animatedStyle = useAnimatedStyle(() => {
    const normalizedX = gestureX.value / containerSize.width;
    const normalizedY = gestureY.value / containerSize.height;
    
    // Interpolate normalizedX (0 to 1) to Y rotation angle
    const rotateYAngle = interpolate(
      normalizedX,
      [0, 0.5, 1],
      [MAX_ROTATE_Y_DEGREES, 0, -MAX_ROTATE_Y_DEGREES], // Invert for intuitive feel (drag right, right edge moves away)
      Extrapolation.CLAMP
    );
    
    // Interpolate normalizedY (0 to 1) to X rotation angle
    const rotateXAngle = interpolate(
      normalizedY,
      [0, 0.5, 1],
      [-MAX_ROTATE_X_DEGREES, 0, MAX_ROTATE_X_DEGREES], // Drag down rotates forward, drag up rotates back
      Extrapolation.CLAMP
    );
    
    return {
      transform: [
        { perspective: 1000 }, // Added perspective for 3D effect
        { rotateX: `${rotateXAngle}deg` }, // Y-axis gesture controls X rotation
        { rotateY: `${rotateYAngle}deg` }, // X-axis gesture controls Y rotation
        { scale: interactionScale.value }, // Apply interaction scale
      ],
    };
  });

  return (
    <GestureHandlerRootView className="flex-1">
      <GestureDetector gesture={panGesture}>
        <View 
          className="flex-1 items-center justify-center scale-125" // Added centering for better visual of rotation
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setContainerSize({ width, height });
            gestureX.value = width / 2; // Initialize gestureX to center
            gestureY.value = height / 2; // Initialize gestureY to center
          }}
        >
          <AnimatedImage
            source={chevreImage}
            style={[styles.imageStyle, animatedStyle]}
            className={`pointer-events-none select-none ${isLoading ? 'opacity-50' : ''}`}
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
    width: '80%', // Adjusted for better visibility of rotation edges
    height: '80%',// Adjusted for better visibility of rotation edges
    // Ensure image itself doesn't have overflow: hidden if perspective is on parent
  }
});