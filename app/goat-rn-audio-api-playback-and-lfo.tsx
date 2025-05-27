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
const MAX_ROTATE_X_DEGREES = 30; // Max rotation for X-axis based on Y gesture
const LFO_MIN_FREQ = 0.5; // Hz
const LFO_MAX_FREQ = 10; // Hz
const LFO_DEPTH = 0.3; // How much LFO affects gain (0 to 1)
const MAIN_GAIN_BASE = 0.7; // Base gain level

// Create an animatable version of ExpoImage
const AnimatedImage = Animated.createAnimatedComponent(ExpoImage);

// Helper to give AudioContext a unique ID for logging
let audioContextInstanceCounter = 0;

export default function GoatRnAudioApiPitchAndLfoScreen() {
  const [isLoading, setIsLoading] = useState(true);
  const [containerSize, setContainerSize] = useState({ width: Dimensions.get('window').width, height: Dimensions.get('window').height });

  const audioContextRef = useRef<AudioContext & { instanceId?: number } | null>(null); // Add instanceId to type
  const audioBufferRef = useRef<RnAudioBuffer | null>(null);
  const playerNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const mainGainNodeRef = useRef<GainNode | null>(null);
  const lfoNodeRef = useRef<OscillatorNode | null>(null);
  const lfoGainNodeRef = useRef<GainNode | null>(null);

  const gestureX = useSharedValue(0);
  const gestureY = useSharedValue(0); // Shared value for Y gesture
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

  const calculatePlaybackRate = (locationX: number, width: number): number => {
    if (width === 0) return 1;
    const normalizedX = Math.max(0, Math.min(1, locationX / width));
    let rate = (normalizedX < 0.5) ? (normalizedX * 2) : (1 + (normalizedX - 0.5) * 2);
    return Math.max(0, Math.min(3, rate));
  };

  const calculateLfoFrequency = (locationY: number, height: number): number => {
    if (height === 0) return LFO_MIN_FREQ;
    // Invert Y: top of screen = max freq, bottom = min freq
    const normalizedY = 1 - Math.max(0, Math.min(1, locationY / height)); 
    return LFO_MIN_FREQ + (normalizedY * (LFO_MAX_FREQ - LFO_MIN_FREQ));
  };

  const panGesture = Gesture.Pan()
    .onBegin(async (event) => {
      isActive.value = true;
      interactionScale.value = withTiming(0.9, { duration: 200 });
      gestureX.value = event.x;
      gestureY.value = event.y;
      
      const audioContext = audioContextRef.current;
      console.log(`[Gesture] onBegin - Using AudioContext ID: ${audioContext?.instanceId}, State: ${audioContext?.state}`);

      const audioBuffer = audioBufferRef.current;
      if (!audioContext || !audioBuffer) {
        console.warn("[Gesture] AudioContext or AudioBuffer not ready in onBegin.");
        if(isLoading) console.warn("[Gesture] Still loading audio data.");
        return;
      }

      if (audioContext.state === 'suspended') {
        console.log("[Gesture] AudioContext is suspended in onBegin, attempting to resume...");
        try {
            await audioContext.resume();
            console.log(`[Gesture] AudioContext ID: ${audioContext.instanceId} resumed in onBegin.`);
        } catch (resumeError) {
            console.error("[Gesture] Failed to resume AudioContext in onBegin:", resumeError);
            return; // Don't proceed if context can't be resumed
        }
      }

      try {
        console.log(`[Gesture] Clearing previous audio nodes (Context ID: ${audioContext.instanceId})`);
        playerNodeRef.current?.stop(); playerNodeRef.current?.disconnect();
        lfoNodeRef.current?.stop(); lfoNodeRef.current?.disconnect();
        mainGainNodeRef.current?.disconnect(); 
        lfoGainNodeRef.current?.disconnect();
        console.log(`[Gesture] Creating new audio nodes (Context ID: ${audioContext.instanceId})`);

        const pNode = await audioContext.createBufferSource();
        console.log(`[Gesture] PlayerNode created (Context ID: ${audioContext.instanceId})`);
        pNode.buffer = audioBuffer;
        pNode.loop = true;
        const initialRate = calculatePlaybackRate(event.x, containerSize.width);
        if (pNode.playbackRate) pNode.playbackRate.value = initialRate;
        playerNodeRef.current = pNode;

        const mGain = await audioContext.createGain();
        console.log(`[Gesture] MainGainNode created (Context ID: ${audioContext.instanceId})`);
        mGain.gain.value = MAIN_GAIN_BASE;
        mainGainNodeRef.current = mGain;

        const lfo = await audioContext.createOscillator();
        console.log(`[Gesture] LFO (OscillatorNode) created (Context ID: ${audioContext.instanceId})`);
        lfo.type = 'sine';
        const initialLfoFreq = calculateLfoFrequency(event.y, containerSize.height);
        lfo.frequency.value = initialLfoFreq;
        lfoNodeRef.current = lfo;

        const lGain = await audioContext.createGain();
        console.log(`[Gesture] LFOGainNode created (Context ID: ${audioContext.instanceId})`);
        lGain.gain.value = LFO_DEPTH;
        lfoGainNodeRef.current = lGain;

        console.log(`[Gesture] Connecting audio graph (Context ID: ${audioContext.instanceId}) - Step 1: Player to MainGain`);
        console.log(`  Player Node Context ID (expected ${audioContext.instanceId}):`, (playerNodeRef.current.context as any)?.instanceId);
        console.log(`  MainGain Node Context ID (expected ${audioContext.instanceId}):`, (mainGainNodeRef.current.context as any)?.instanceId);
        playerNodeRef.current.connect(mainGainNodeRef.current);

        console.log(`[Gesture] Connecting audio graph (Context ID: ${audioContext.instanceId}) - Step 2: MainGain to Destination`);
        console.log(`  MainGain Node Context ID (expected ${audioContext.instanceId}):`, (mainGainNodeRef.current.context as any)?.instanceId);
        // console.log(`  Destination Node Context ID: ${audioContext.destination.context.instanceId}`); // Destination doesn't have context.context
        mainGainNodeRef.current.connect(audioContext.destination);

        console.log(`[Gesture] Connecting audio graph (Context ID: ${audioContext.instanceId}) - Step 3: LFO to LFOGain`);
        console.log(`  LFO Node Context ID (expected ${audioContext.instanceId}):`, (lfoNodeRef.current.context as any)?.instanceId);
        console.log(`  LFOGain Node Context ID (expected ${audioContext.instanceId}):`, (lfoGainNodeRef.current.context as any)?.instanceId);
        lfoNodeRef.current.connect(lfoGainNodeRef.current);

        console.log(`[Gesture] Connecting audio graph (Context ID: ${audioContext.instanceId}) - Step 4: LFOGain to MainGain.gain`);
        console.log(`  LFOGain Node Context ID (expected ${audioContext.instanceId}):`, (lfoGainNodeRef.current.context as any)?.instanceId);
        console.log(`  MainGain Node (for .gain param) Context ID (expected ${audioContext.instanceId}):`, (mainGainNodeRef.current.context as any)?.instanceId);
        // The .gain AudioParam itself also has a .context property in standard Web Audio API
        console.log(`  MainGain.gain AudioParam Context ID (expected ${audioContext.instanceId}):`, ((mainGainNodeRef.current.gain as any).context as any)?.instanceId);
        lfoGainNodeRef.current.connect(mainGainNodeRef.current.gain);

        console.log(`[Gesture] Starting LFO and PlayerNode (Context ID: ${audioContext.instanceId})`);
        lfoNodeRef.current.start(audioContext.currentTime);
        playerNodeRef.current.start(audioContext.currentTime);
        console.log(`[Gesture] Sound started. Rate: ${initialRate}, LFO Freq: ${initialLfoFreq}`);
      } catch (error) {
        console.error("[Gesture] Failed to start sound (onBegin try/catch):", error);
      }
    })
    .onUpdate((event) => {
      if (!isActive.value) return;
      gestureX.value = event.x;
      gestureY.value = event.y;
      const audioContext = audioContextRef.current; // Added for safety

      if (playerNodeRef.current?.playbackRate && audioContext) {
        playerNodeRef.current.playbackRate.value = calculatePlaybackRate(event.x, containerSize.width);
      }
      if (lfoNodeRef.current?.frequency && audioContext) {
        lfoNodeRef.current.frequency.value = calculateLfoFrequency(event.y, containerSize.height);
      }
    })
    .onFinalize((event, success) => {
      isActive.value = false;
      interactionScale.value = withTiming(1, { duration: 200 });
      gestureX.value = withSpring(containerSize.width / 2, { damping: 15, stiffness: 120 });
      gestureY.value = withSpring(containerSize.height / 2, { damping: 15, stiffness: 120 });
      const audioContext = audioContextRef.current; // Added for safety
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
            gestureY.value = height / 2; // Initialize Y gesture to center
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