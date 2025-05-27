import { Image as ExpoImage } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { AudioBufferSourceNode, AudioContext } from 'react-native-audio-api';
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

// Create an animatable version of ExpoImage
const AnimatedImage = Animated.createAnimatedComponent(ExpoImage);

export default function GoatRnAudioApiPitchScreen() {
  const [isLoading, setIsLoading] = useState(true);
  const [containerWidth, setContainerWidth] = useState(Dimensions.get('window').width);

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<RnAudioBuffer | null>(null);
  const playerNodeRef = useRef<AudioBufferSourceNode | null>(null);

  // Reanimated shared value for skewX
  const gestureX = useSharedValue(0);
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

  const panGesture = Gesture.Pan()
    .onBegin(async (event) => {
      isActive.value = true;
      interactionScale.value = withTiming(0.9, { duration: 200 }); // Scale down on press
      gestureX.value = event.x; // Store initial X for animation reference if needed
      console.log("[Gesture] onBegin", event.state);
      const audioContext = audioContextRef.current;
      const audioBuffer = audioBufferRef.current;
      if (!audioContext || !audioBuffer || isLoading) {
        console.log("[Gesture] Audio not ready or still loading onBegin.");
        return;
      }

      try {
        if (playerNodeRef.current) {
          playerNodeRef.current.stop();
          playerNodeRef.current.disconnect();
        }
        
        const newPlayerNode = await audioContext.createBufferSource({
          pitchCorrection: true,
        });
        newPlayerNode.buffer = audioBuffer;
        newPlayerNode.loop = true;
        
        const initialRate = calculatePlaybackRate(event.x, containerWidth);
        if (newPlayerNode.playbackRate) {
          console.log("[Gesture] setting playbackRate to", initialRate);
          newPlayerNode.playbackRate.value = initialRate;
        } else {
          console.warn('[Gesture] playbackRate not directly available on playerNode');
        }

        newPlayerNode.connect(audioContext.destination);
        newPlayerNode.start(audioContext.currentTime);
        playerNodeRef.current = newPlayerNode;
        console.log("[Gesture] Sound started. Rate:", initialRate);
      } catch (error) {
        console.error("[Gesture] Failed to start sound:", error);
      }
    })
    .onStart((event) => {
      console.log("[Gesture] onStart", event.state);
    })
    .onUpdate((event) => {
      if(isActive.value) gestureX.value = event.x;
      if (playerNodeRef.current && playerNodeRef.current.playbackRate) {
        const newRate = calculatePlaybackRate(event.x, containerWidth);
        console.log("[Gesture] setting playbackRate to", newRate);
        playerNodeRef.current.playbackRate.value = newRate;
      } else if (playerNodeRef.current && !playerNodeRef.current.playbackRate) {
        // console.warn("[Gesture] playbackRate not available on playerNode during update");
      }
    })
    .onEnd((event) => {
      console.log("[Gesture] onEnd - State:", event.state);
    })
    .onFinalize((event, success) => {
      isActive.value = false;
      interactionScale.value = withTiming(1, { duration: 200 }); // Scale back to normal
      gestureX.value = withSpring(containerWidth / 2, { damping: 15, stiffness:120 }); // Animate X back to center for skew
      console.log(`[Gesture] onFinalize - Success: ${success}, State: ${event.state}`);
      if (playerNodeRef.current) {
        try {
          console.log("[Gesture] Stopping sound via onFinalize...");
          playerNodeRef.current.stop();
          playerNodeRef.current.disconnect();
          playerNodeRef.current = null;
          console.log("[Gesture] Sound stopped and disconnected via onFinalize.");
        } catch (error) {
          console.error("[Gesture] Failed to stop sound via onFinalize:", error);
        }
      } else {
        console.log("[Gesture] onFinalize called but no playerNode to stop.");
      }
    });

  // Animated style for the image skew
  const animatedStyle = useAnimatedStyle(() => {
    const normalizedX = gestureX.value / containerWidth;
    // Interpolate normalizedX (0 to 1) to skew angle (-MAX_SKEW_DEGREES to MAX_SKEW_DEGREES)
    // Center (0.5) should be 0 degrees
    const rotateYAngle = interpolate(
      normalizedX,
      [0, 0.5, 1],
      [MAX_ROTATE_Y_DEGREES, 0, -MAX_ROTATE_Y_DEGREES], // Invert for intuitive feel (drag right, right edge moves away)
      Extrapolation.CLAMP
    );
    return {
      transform: [
        { perspective: 1000 }, // Added perspective for 3D effect
        { rotateY: `${rotateYAngle}deg` },
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
            const { width } = event.nativeEvent.layout;
            setContainerWidth(width);
            gestureX.value = width / 2; // Initialize gestureX to center
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