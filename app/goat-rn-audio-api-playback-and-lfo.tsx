import { Image as ExpoImage } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { AudioBufferSourceNode, AudioContext, BiquadFilterNode, GainNode, OscillatorNode } from 'react-native-audio-api';
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
const LFO_MIN_FREQ_EFFECT = 0.5; // Min speed of LFO for effects
const LFO_MAX_FREQ_EFFECT = 8;   // Max speed of LFO for effects (e.g., wah speed)
const FILTER_MIN_FREQ = 200;     // Base frequency of filter when Y is at center or below
const FILTER_MAX_FREQ = 3000;    // Max frequency for filter sweep (wah top)
const FILTER_MIN_Q = 0.5;        // Filter Q when Y is at center or below (less resonance)
const FILTER_MAX_Q = 10;         // Filter Q at max Y for strong wah resonance
const LFO_FILTER_SWEEP_DEPTH_MIN = 50; // Min amount LFO moves filter freq (Hz)
const LFO_FILTER_SWEEP_DEPTH_MAX = 1500; // Max amount LFO moves filter freq (Hz)
const MAIN_GAIN_BASE = 0.7; // Keep main volume reasonable
const FIXED_PLAYBACK_RATE = 1;

// Create an animatable version of ExpoImage
const AnimatedImage = Animated.createAnimatedComponent(ExpoImage);

// Helper to give AudioContext a unique ID for logging
let audioContextInstanceCounter = 0;

export default function GoatCreativeAudioEffectsScreen() {
  const [isLoading, setIsLoading] = useState(true);
  const [containerSize, setContainerSize] = useState({ width: Dimensions.get('window').width, height: Dimensions.get('window').height });

  const audioContextRef = useRef<AudioContext & { instanceId?: number } | null>(null);
  const audioBufferRef = useRef<RnAudioBuffer | null>(null);
  const playerNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const mainGainNodeRef = useRef<GainNode | null>(null);
  const lfoNodeRef = useRef<OscillatorNode | null>(null);
  const lfoGainNodeRef = useRef<GainNode | null>(null);
  const filterNodeRef = useRef<BiquadFilterNode | null>(null);

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

  const getNormalizedYCentered = (locationY: number, height: number): number => {
    if (height === 0) return 0;
    return ((height - locationY) / height) * 2 - 1; 
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
      if (!audioContext || !audioBuffer || isLoading) { console.warn("[Gesture] Audio not ready."); return; }
      if (audioContext.state === 'suspended') await audioContext.resume();

      try {
        playerNodeRef.current?.stop(); playerNodeRef.current?.disconnect();
        lfoNodeRef.current?.stop(); lfoNodeRef.current?.disconnect();
        mainGainNodeRef.current?.disconnect();
        lfoGainNodeRef.current?.disconnect();
        filterNodeRef.current?.disconnect();

        const pNode = await audioContext.createBufferSource();
        pNode.buffer = audioBuffer;
        pNode.loop = true;
        if (pNode.playbackRate) pNode.playbackRate.value = FIXED_PLAYBACK_RATE;
        playerNodeRef.current = pNode;

        const mGain = await audioContext.createGain();
        mGain.gain.value = MAIN_GAIN_BASE;
        mainGainNodeRef.current = mGain;

        const filter = await audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filterNodeRef.current = filter;

        const lfo = await audioContext.createOscillator();
        lfo.type = 'sine';
        lfoNodeRef.current = lfo;

        const lGain = await audioContext.createGain();
        lfoGainNodeRef.current = lGain;

        const normYCentered = getNormalizedYCentered(event.y, containerSize.height);
        
        const initialLfoFreq = LFO_MIN_FREQ_EFFECT + (Math.abs(normYCentered) * (LFO_MAX_FREQ_EFFECT - LFO_MIN_FREQ_EFFECT));
        lfo.frequency.value = initialLfoFreq;

        if (normYCentered >= 0) {
          console.log("[onBegin] Activating Filter Wah");
          const yPosUp = normYCentered;
          filter.frequency.value = FILTER_MIN_FREQ + (yPosUp * (FILTER_MAX_FREQ - FILTER_MIN_FREQ));
          filter.Q.value = FILTER_MIN_Q + (yPosUp * (FILTER_MAX_Q - FILTER_MIN_Q));
          lGain.gain.value = LFO_FILTER_SWEEP_DEPTH_MIN + (yPosUp * (LFO_FILTER_SWEEP_DEPTH_MAX - LFO_FILTER_SWEEP_DEPTH_MIN));
          lfoGainNodeRef.current.connect(filterNodeRef.current);
        } else {
          console.log("[onBegin] Y Down - Neutralizing Filter (Flanger TBD)");
          filter.frequency.value = FILTER_MAX_FREQ;
          filter.Q.value = 0.1;
          lGain.gain.value = 0;
          lfoGainNodeRef.current.connect(filterNodeRef.current);
        }

        playerNodeRef.current.connect(mainGainNodeRef.current);
        mainGainNodeRef.current.connect(filterNodeRef.current);
        filterNodeRef.current.connect(audioContext.destination);
        lfoNodeRef.current.connect(lfoGainNodeRef.current);

        lfoNodeRef.current.start(audioContext.currentTime);
        playerNodeRef.current.start(audioContext.currentTime);
        console.log(`[Gesture] Sound started. LFO Freq: ${initialLfoFreq.toFixed(2)}`);
      } catch (error) {
        console.error("[Gesture] Failed to start sound (onBegin try/catch):", error);
      }
    })
    .onUpdate((event) => {
      if (!isActive.value) return;
      gestureX.value = event.x;
      gestureY.value = event.y;
      const audioContext = audioContextRef.current;
      if (!audioContext || !filterNodeRef.current || !lfoNodeRef.current || !lfoGainNodeRef.current) return;

      const normYCentered = getNormalizedYCentered(event.y, containerSize.height);
      const currentLfoFreq = LFO_MIN_FREQ_EFFECT + (Math.abs(normYCentered) * (LFO_MAX_FREQ_EFFECT - LFO_MIN_FREQ_EFFECT));
      lfoNodeRef.current.frequency.value = currentLfoFreq;

      if (normYCentered >= 0) {
        const yPosUp = normYCentered;
        filterNodeRef.current.frequency.value = FILTER_MIN_FREQ + (yPosUp * (FILTER_MAX_FREQ - FILTER_MIN_FREQ));
        filterNodeRef.current.Q.value = FILTER_MIN_Q + (yPosUp * (FILTER_MAX_Q - FILTER_MIN_Q));
        lfoGainNodeRef.current.gain.value = LFO_FILTER_SWEEP_DEPTH_MIN + (yPosUp * (LFO_FILTER_SWEEP_DEPTH_MAX - LFO_FILTER_SWEEP_DEPTH_MIN));
      } else {
        filterNodeRef.current.frequency.value = FILTER_MAX_FREQ;
        filterNodeRef.current.Q.value = 0.1;
        lfoGainNodeRef.current.gain.value = 0;
      }
    })
    .onFinalize((event, success) => {
      isActive.value = false;
      interactionScale.value = withTiming(1, { duration: 200 });
      gestureX.value = withSpring(containerSize.width / 2, { damping: 15, stiffness: 120 });
      gestureY.value = withSpring(containerSize.height / 2, { damping: 15, stiffness: 120 });
      const audioContext = audioContextRef.current;
      console.log(`[Gesture] onFinalize (Context ID: ${audioContext?.instanceId})`);
      
      playerNodeRef.current?.stop();
      lfoNodeRef.current?.stop();
      playerNodeRef.current?.disconnect();
      lfoNodeRef.current?.disconnect();
      mainGainNodeRef.current?.disconnect();
      lfoGainNodeRef.current?.disconnect();
      filterNodeRef.current?.disconnect();
      playerNodeRef.current = null;
      lfoNodeRef.current = null;
      mainGainNodeRef.current = null;
      lfoGainNodeRef.current = null;
      filterNodeRef.current = null;
      console.log("[Gesture] Sound stopped and all nodes disconnected.");
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