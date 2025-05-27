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

const MAX_ROTATE_Y_DEGREES = 45;
const MAX_ROTATE_X_DEGREES = 30;
const LFO_MIN_FREQ = 0.5; 
const LFO_MAX_FREQ = 15; // Adjusted for more perceptible volume flutter
const LFO_MIN_DEPTH = 0.0;  // LFO Depth is 0 at center Y
const LFO_MAX_DEPTH = 0.5;  // Max depth allows 0-1 volume swing with MAIN_GAIN_BASE = 0.5
const MAIN_GAIN_BASE = 0.5; 
const FIXED_PLAYBACK_RATE = 1;

// Create an animatable version of ExpoImage
const AnimatedImage = Animated.createAnimatedComponent(ExpoImage);

// Helper to give AudioContext a unique ID for logging
let audioContextInstanceCounter = 0;

export default function GoatRnAudioApiPitchAndLfoScreen() {
  const [isLoading, setIsLoading] = useState(true);
  const [containerSize, setContainerSize] = useState({ width: Dimensions.get('window').width, height: Dimensions.get('window').height });

  const audioContextRef = useRef<AudioContext & { instanceId?: number } | null>(null);
  const audioBufferRef = useRef<RnAudioBuffer | null>(null);
  const playerNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const mainGainNodeRef = useRef<GainNode | null>(null);
  const lfoNodeRef = useRef<OscillatorNode | null>(null);
  const lfoGainNodeRef = useRef<GainNode | null>(null);

  const gestureX = useSharedValue(0);
  const gestureY = useSharedValue(0);
  const isActive = useSharedValue(false);
  const interactionScale = useSharedValue(1);

  useEffect(() => {
    console.log("[Effect] Init audio effect running");
    const initAudio = async () => {
      try {
        if (!audioContextRef.current) {
          console.log("[Effect] Creating new AudioContext instance.");
          const context = new AudioContext() as AudioContext & { instanceId?: number };
          context.instanceId = ++audioContextInstanceCounter;
          audioContextRef.current = context;
          console.log(`[Effect] AudioContext created with ID: ${context.instanceId}`);
          
          if (context.state === 'suspended') {
            console.log("[Effect] AudioContext is suspended. Attempting to set up resume listeners.");
            const resumeContext = () => {
              if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
                console.log("[Effect] User gesture detected, resuming AudioContext...");
                audioContextRef.current.resume().then(() => {
                  console.log(`[Effect] AudioContext ID: ${audioContextRef.current?.instanceId} resumed.`);
                  document.removeEventListener('click', resumeContext, true);
                  document.removeEventListener('touchstart', resumeContext, true);
                }).catch(err => console.error("[Effect] Error resuming AudioContext:", err));
              } else {
                // Context already resumed or changed, clean up listeners
                document.removeEventListener('click', resumeContext, true);
                document.removeEventListener('touchstart', resumeContext, true);
              }
            };
            // Use capture phase for event listeners to catch them early
            document.addEventListener('click', resumeContext, true);
            document.addEventListener('touchstart', resumeContext, true);
          }
        } else {
          console.log(`[Effect] AudioContext already exists with ID: ${audioContextRef.current.instanceId}`);
        }
        
        const currentAudioContext = audioContextRef.current;
        if (!currentAudioContext) {
          console.error("[Effect] AudioContext could not be initialized or became null.");
          setIsLoading(false);
          return;
        }
        console.log(`[Effect] Using AudioContext ID: ${currentAudioContext.instanceId} for decoding.`);

        const response = await fetch(audioFileUri);
        const arrayBuffer = await response.arrayBuffer();
        
        currentAudioContext.decodeAudioData(arrayBuffer)
          .then((decodedBuffer) => {
            audioBufferRef.current = decodedBuffer as RnAudioBuffer;
            setIsLoading(false);
            console.log(`[Effect] Audio loaded successfully (Context ID: ${currentAudioContext.instanceId})`);
          })
          .catch((err: DOMException | Error) => {
            console.error(`[Effect] Error decoding audio data (Context ID: ${currentAudioContext.instanceId}):`, err);
            setIsLoading(false);
          });
      } catch (error) {
        console.error("[Effect] Failed to initialize audio:", error);
        setIsLoading(false);
      }
    };
    initAudio();
    return () => { 
      console.log("[Effect] Cleanup function running.");
      // Potentially add audioContext.close() here if app is unmounting
      // and ensure listeners for resume are removed.
    };
  }, []);

  const calculateLfoFrequency = (locationY: number, height: number): number => {
    if (height === 0) return LFO_MIN_FREQ;
    const normalizedY = 1 - Math.max(0, Math.min(1, locationY / height)); 
    return LFO_MIN_FREQ + (normalizedY * (LFO_MAX_FREQ - LFO_MIN_FREQ));
  };

  // Updated function for LFO depth: 0 at center, max at top/bottom
  const calculateLfoDepth = (locationY: number, height: number): number => {
    if (height === 0) return LFO_MIN_DEPTH; // Should be 0 if LFO_MIN_DEPTH is 0
    // Normalize Y from -1 (bottom) to +1 (top), with 0 at center
    const normalizedYCentered = ((height - locationY) / height) * 2 - 1; 
    const absNormalizedY = Math.abs(normalizedYCentered); 
    return LFO_MIN_DEPTH + (absNormalizedY * (LFO_MAX_DEPTH - LFO_MIN_DEPTH));
  };

  const panGesture = Gesture.Pan()
    .onBegin(async (event) => {
      isActive.value = true;
      interactionScale.value = withTiming(0.9, { duration: 200 });
      gestureX.value = event.x;
      gestureY.value = event.y;
      console.log("[Gesture] onBegin");

      const audioContext = audioContextRef.current;
      const audioBuffer = audioBufferRef.current;
      if (!audioContext || !audioBuffer) {
        console.warn("[Gesture] AudioContext or AudioBuffer not ready in onBegin.");
        if(isLoading) console.warn("[Gesture] Still loading audio data.");
        return;
      }
      if (audioContext.state === 'suspended') await audioContext.resume();

      try {
        playerNodeRef.current?.stop(); playerNodeRef.current?.disconnect();
        lfoNodeRef.current?.stop(); lfoNodeRef.current?.disconnect();
        mainGainNodeRef.current?.disconnect(); 
        lfoGainNodeRef.current?.disconnect();

        const pNode = await audioContext.createBufferSource();
        pNode.buffer = audioBuffer;
        pNode.loop = true;
        if (pNode.playbackRate) pNode.playbackRate.value = FIXED_PLAYBACK_RATE;
        playerNodeRef.current = pNode;

        const mGain = await audioContext.createGain();
        mGain.gain.value = MAIN_GAIN_BASE;
        mainGainNodeRef.current = mGain;

        const lfo = await audioContext.createOscillator();
        lfo.type = 'square'; 
        const initialLfoFreq = calculateLfoFrequency(event.y, containerSize.height);
        lfo.frequency.value = initialLfoFreq;
        lfoNodeRef.current = lfo;

        const lGain = await audioContext.createGain();
        const initialLfoDepth = calculateLfoDepth(event.y, containerSize.height);
        lGain.gain.value = initialLfoDepth;
        lfoGainNodeRef.current = lGain;

        playerNodeRef.current.connect(mainGainNodeRef.current);
        mainGainNodeRef.current.connect(audioContext.destination);
        lfoNodeRef.current.connect(lfoGainNodeRef.current);
        lfoGainNodeRef.current.connect(mainGainNodeRef.current); 

        lfoNodeRef.current.start(audioContext.currentTime);
        playerNodeRef.current.start(audioContext.currentTime);
        console.log(`[Gesture] Sound started. Fixed Rate: ${FIXED_PLAYBACK_RATE}, LFO Freq: ${initialLfoFreq.toFixed(2)}, LFO Depth: ${initialLfoDepth.toFixed(2)}`);
      } catch (error) {
        console.error("[Gesture] Failed to start sound (onBegin try/catch):", error);
      }
    })
    .onUpdate((event) => {
      if (!isActive.value) return;
      gestureX.value = event.x;
      gestureY.value = event.y; 
      const audioContext = audioContextRef.current;
      
      if (lfoNodeRef.current?.frequency && lfoGainNodeRef.current?.gain && audioContext) {
        const newLfoFreq = calculateLfoFrequency(event.y, containerSize.height);
        const newLfoDepth = calculateLfoDepth(event.y, containerSize.height); // Calculate new depth
        // console.log(`[Gesture Update] event.y: ${event.y.toFixed(2)}, LFO Freq: ${newLfoFreq.toFixed(2)}, LFO Depth: ${newLfoDepth.toFixed(2)}`); // Keep this for debugging
        lfoNodeRef.current.frequency.value = newLfoFreq;
        lfoGainNodeRef.current.gain.value = newLfoDepth; // Update LFO depth
      } else {
        if (isActive.value) {
            console.warn("[Gesture Update] LFO/Gain Node or params not available or audioContext missing.");
        }
      }
    })
    .onFinalize((event, success) => {
      isActive.value = false;
      interactionScale.value = withTiming(1, { duration: 200 });
      gestureX.value = withSpring(containerSize.width / 2, { damping: 15, stiffness: 120 });
      gestureY.value = withSpring(containerSize.height / 2, { damping: 15, stiffness: 120 });
      const audioContext = audioContextRef.current;
      console.log(`[Gesture] onFinalize - Success: ${success} (Context ID: ${audioContext?.instanceId})`);
      
      playerNodeRef.current?.stop();
      lfoNodeRef.current?.stop();
      playerNodeRef.current?.disconnect();
      lfoNodeRef.current?.disconnect();
      mainGainNodeRef.current?.disconnect();
      lfoGainNodeRef.current?.disconnect();

      playerNodeRef.current = null;
      lfoNodeRef.current = null;
      mainGainNodeRef.current = null;
      lfoGainNodeRef.current = null;
      console.log("[Gesture] Sound stopped and all nodes disconnected via onFinalize.");
    });

  const animatedStyle = useAnimatedStyle(() => {
    const normalizedX = gestureX.value / containerSize.width;
    const normalizedY = gestureY.value / containerSize.height;
    const rotateYAngle = interpolate(normalizedX, [0, 0.5, 1], [MAX_ROTATE_Y_DEGREES, 0, -MAX_ROTATE_Y_DEGREES], Extrapolation.CLAMP);
    const rotateXAngle = interpolate(normalizedY, [0, 0.5, 1], [-MAX_ROTATE_X_DEGREES, 0, MAX_ROTATE_X_DEGREES], Extrapolation.CLAMP);
    return {
      transform: [
        { perspective: 1000 },
        { rotateX: `${rotateXAngle}deg` },
        { rotateY: `${rotateYAngle}deg` },
        { scale: interactionScale.value },
      ],
    };
  });

  return (
    <GestureHandlerRootView className="flex-1">
      <GestureDetector gesture={panGesture}>
        <View 
          className="flex-1 items-center justify-center scale-125" 
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setContainerSize({ width, height });
            gestureX.value = width / 2;
            gestureY.value = height / 2;
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
    width: '80%',
    height: '80%',
  }
});