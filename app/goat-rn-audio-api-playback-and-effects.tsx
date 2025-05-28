import { Image as ExpoImage } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
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
const LFO_MAX_FREQ = 20;   // Max LFO frequency (Hz)
const LFO_MIN_DEPTH = 0;  // Min LFO depth (no effect at center)
const LFO_MAX_DEPTH = 1; // Max LFO depth (30% volume modulation at top)
const BASE_GAIN = 0.7; // Base volume level

// Flanger parameters for lower Y-axis
const FLANGER_MIN_DELAY = 0.001; // Min delay time (1ms)
const FLANGER_MAX_DELAY = 0.003; // Max delay time (8ms)
const FLANGER_LFO_MIN_FREQ = 2; // Min flanger LFO frequency
const FLANGER_LFO_MAX_FREQ = 10;   // Max flanger LFO frequency
const FLANGER_FEEDBACK = 0.5;     // Feedback amount for flanger
const FLANGER_MIX = 0.8;          // Wet/dry mix for flanger

// Create an animatable version of ExpoImage
const AnimatedImage = Animated.createAnimatedComponent(ExpoImage);

export default function GoatRnAudioApiPitchScreen() {
  const [isLoading, setIsLoading] = useState(true);
  const [containerSize, setContainerSize] = useState({ 
    width: Dimensions.get('window').width, 
    height: Dimensions.get('window').height 
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const playerNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const mainGainNodeRef = useRef<GainNode | null>(null);
  const lfoNodeRef = useRef<OscillatorNode | null>(null);
  const lfoGainNodeRef = useRef<GainNode | null>(null);

  // Flanger effect nodes
  const delayNodeRef = useRef<DelayNode | null>(null);
  const flangerLfoNodeRef = useRef<OscillatorNode | null>(null);
  const flangerLfoGainNodeRef = useRef<GainNode | null>(null);
  const flangerFeedbackNodeRef = useRef<GainNode | null>(null);
  const flangerMixNodeRef = useRef<GainNode | null>(null);
  const flangerDryNodeRef = useRef<GainNode | null>(null);

  // Reanimated shared values for both X and Y
  const gestureX = useSharedValue(0);
  const gestureY = useSharedValue(0);
  const isActive = useSharedValue(false);
  const interactionScale = useSharedValue(1); // Shared value for interaction scale

  useEffect(() => {
    const initAudio = async () => {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const currentAudioContext = audioContextRef.current;
        if (!currentAudioContext) {
          console.error("AudioContext could not be initialized.");
          setIsLoading(false);
          return;
        }

        // Resume AudioContext if suspended (required for user interaction)
        if (currentAudioContext.state === 'suspended') {
          await currentAudioContext.resume();
        }

        const response = await fetch(audioFileUri);
        const arrayBuffer = await response.arrayBuffer();
        
        currentAudioContext.decodeAudioData(arrayBuffer)
          .then((decodedBuffer) => {
            audioBufferRef.current = decodedBuffer;
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

  // Calculate flanger parameters based on Y position (lower half only)
  const calculateFlangerParams = (normalizedY: number) => {
    if (normalizedY >= 0) {
      // Upper half or center - no flanger effect
      return { 
        delayTime: FLANGER_MIN_DELAY, 
        lfoFreq: FLANGER_LFO_MIN_FREQ, 
        lfoDepth: 0,
        mix: 0 
      };
    }
    
    // Lower half - scale from 0 to 1 (absolute value since normalizedY is negative)
    const intensity = Math.abs(normalizedY); // 0 at center, 1 at bottom
    const delayTime = FLANGER_MIN_DELAY + (intensity * (FLANGER_MAX_DELAY - FLANGER_MIN_DELAY));
    const lfoFreq = FLANGER_LFO_MIN_FREQ + (intensity * (FLANGER_LFO_MAX_FREQ - FLANGER_LFO_MIN_FREQ));
    const lfoDepth = intensity * (FLANGER_MAX_DELAY - FLANGER_MIN_DELAY) * 0.5; // LFO modulates delay time
    const mix = intensity * FLANGER_MIX;
    
    return { delayTime, lfoFreq, lfoDepth, mix };
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
        // Resume AudioContext if suspended
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }

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
        
        // Clean up flanger nodes
        if (flangerLfoNodeRef.current) {
          flangerLfoNodeRef.current.stop();
          flangerLfoNodeRef.current.disconnect();
        }
        if (delayNodeRef.current) {
          delayNodeRef.current.disconnect();
        }
        if (flangerLfoGainNodeRef.current) {
          flangerLfoGainNodeRef.current.disconnect();
        }
        if (flangerFeedbackNodeRef.current) {
          flangerFeedbackNodeRef.current.disconnect();
        }
        if (flangerMixNodeRef.current) {
          flangerMixNodeRef.current.disconnect();
        }
        if (flangerDryNodeRef.current) {
          flangerDryNodeRef.current.disconnect();
        }
        
        // Create audio nodes using native Web Audio API
        const newPlayerNode = audioContext.createBufferSource();
        newPlayerNode.buffer = audioBuffer;
        newPlayerNode.loop = true;
        
        const mainGain = audioContext.createGain();
        mainGain.gain.setValueAtTime(BASE_GAIN, audioContext.currentTime);
        
        // Tremolo LFO nodes (for upper Y-axis)
        const lfoNode = audioContext.createOscillator();
        lfoNode.type = 'sine';
        const lfoGain = audioContext.createGain();
        
        // Flanger nodes (for lower Y-axis)
        const delayNode = audioContext.createDelay(FLANGER_MAX_DELAY);
        const flangerLfo = audioContext.createOscillator();
        flangerLfo.type = 'sine';
        const flangerLfoGain = audioContext.createGain();
        const flangerFeedback = audioContext.createGain();
        const flangerMix = audioContext.createGain(); // Wet signal
        const flangerDry = audioContext.createGain();  // Dry signal
        
        // Set initial playback rate based on X position
        const initialRate = calculatePlaybackRate(event.x, containerSize.width);
        newPlayerNode.playbackRate.setValueAtTime(initialRate, audioContext.currentTime);
        
        // Set initial effect parameters based on Y position
        const normalizedY = getNormalizedYCentered(event.y, containerSize.height);
        const lfoParams = calculateLFOParams(normalizedY);
        const flangerParams = calculateFlangerParams(normalizedY);
        
        // Configure tremolo LFO
        lfoNode.frequency.setValueAtTime(lfoParams.frequency, audioContext.currentTime);
        lfoGain.gain.setValueAtTime(lfoParams.depth, audioContext.currentTime);
        
        // Configure flanger
        delayNode.delayTime.setValueAtTime(flangerParams.delayTime, audioContext.currentTime);
        flangerLfo.frequency.setValueAtTime(flangerParams.lfoFreq, audioContext.currentTime);
        flangerLfoGain.gain.setValueAtTime(flangerParams.lfoDepth, audioContext.currentTime);
        flangerFeedback.gain.setValueAtTime(FLANGER_FEEDBACK, audioContext.currentTime);
        flangerMix.gain.setValueAtTime(flangerParams.mix, audioContext.currentTime);
        flangerDry.gain.setValueAtTime(1 - flangerParams.mix, audioContext.currentTime);
        
        // Connect the audio graph
        // Main signal path: Player → MainGain → [Dry/Wet Split] → Destination
        newPlayerNode.connect(mainGain);
        
        // Split signal for flanger dry/wet mix
        mainGain.connect(flangerDry); // Dry path
        mainGain.connect(delayNode);  // Wet path through delay
        
        // Flanger wet path: Delay → FlangerMix → Destination
        delayNode.connect(flangerMix);
        
        // Flanger feedback: Delay → Feedback → Delay (creates resonance)
        delayNode.connect(flangerFeedback);
        flangerFeedback.connect(delayNode);
        
        // Flanger LFO modulates delay time
        flangerLfo.connect(flangerLfoGain);
        flangerLfoGain.connect(delayNode.delayTime);
        
        // Mix dry and wet signals to destination
        flangerDry.connect(audioContext.destination);
        flangerMix.connect(audioContext.destination);
        
        // Connect tremolo LFO to main gain for volume modulation (only if there's depth)
        if (lfoParams.depth > 0) {
          lfoNode.connect(lfoGain);
          lfoGain.connect(mainGain.gain);
        }
        
        // Store references
        playerNodeRef.current = newPlayerNode;
        mainGainNodeRef.current = mainGain;
        lfoNodeRef.current = lfoNode;
        lfoGainNodeRef.current = lfoGain;
        delayNodeRef.current = delayNode;
        flangerLfoNodeRef.current = flangerLfo;
        flangerLfoGainNodeRef.current = flangerLfoGain;
        flangerFeedbackNodeRef.current = flangerFeedback;
        flangerMixNodeRef.current = flangerMix;
        flangerDryNodeRef.current = flangerDry;
        
        // Start audio
        lfoNode.start(audioContext.currentTime);
        flangerLfo.start(audioContext.currentTime);
        newPlayerNode.start(audioContext.currentTime);
        
        console.log("[Gesture] Sound started. Rate:", initialRate, "LFO:", lfoParams, "Flanger:", flangerParams);
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
      
      const audioContext = audioContextRef.current;
      if (!audioContext) return;
      
      // Update playback rate based on X position
      if (playerNodeRef.current && playerNodeRef.current.playbackRate) {
        const newRate = calculatePlaybackRate(event.x, containerSize.width);
        playerNodeRef.current.playbackRate.setValueAtTime(newRate, audioContext.currentTime);
      }
      
      // Update LFO parameters based on Y position
      if (lfoNodeRef.current && lfoGainNodeRef.current && mainGainNodeRef.current) {
        const normalizedY = getNormalizedYCentered(event.y, containerSize.height);
        const lfoParams = calculateLFOParams(normalizedY);
        const flangerParams = calculateFlangerParams(normalizedY);
        
        // Update tremolo LFO (upper Y-axis)
        lfoNodeRef.current.frequency.setValueAtTime(lfoParams.frequency, audioContext.currentTime);
        lfoGainNodeRef.current.gain.setValueAtTime(lfoParams.depth, audioContext.currentTime);
        
        // Update flanger parameters (lower Y-axis)
        if (delayNodeRef.current && flangerLfoNodeRef.current && flangerLfoGainNodeRef.current && 
            flangerMixNodeRef.current && flangerDryNodeRef.current) {
          
          delayNodeRef.current.delayTime.setValueAtTime(flangerParams.delayTime, audioContext.currentTime);
          flangerLfoNodeRef.current.frequency.setValueAtTime(flangerParams.lfoFreq, audioContext.currentTime);
          flangerLfoGainNodeRef.current.gain.setValueAtTime(flangerParams.lfoDepth, audioContext.currentTime);
          flangerMixNodeRef.current.gain.setValueAtTime(flangerParams.mix, audioContext.currentTime);
          flangerDryNodeRef.current.gain.setValueAtTime(1 - flangerParams.mix, audioContext.currentTime);
        }
        
        // Handle tremolo LFO connection/disconnection based on depth
        if (lfoParams.depth > 0) {
          // Ensure tremolo LFO is connected to gain.gain AudioParam
          try {
            // Disconnect first to avoid multiple connections
            lfoGainNodeRef.current.disconnect();
            lfoNodeRef.current.disconnect(lfoGainNodeRef.current);
            
            // Reconnect properly
            lfoNodeRef.current.connect(lfoGainNodeRef.current);
            lfoGainNodeRef.current.connect(mainGainNodeRef.current.gain);
          } catch (e) {
            // Connection might already exist or other issue, try simple reconnect
            try {
              lfoNodeRef.current.connect(lfoGainNodeRef.current);
              lfoGainNodeRef.current.connect(mainGainNodeRef.current.gain);
            } catch (e2) {
              console.warn("Tremolo LFO connection issue:", e2);
            }
          }
        } else {
          // Disconnect tremolo LFO when depth is 0
          try {
            lfoGainNodeRef.current.disconnect(mainGainNodeRef.current.gain);
          } catch (e) {
            // Already disconnected
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
      
      if (flangerLfoNodeRef.current) {
        flangerLfoNodeRef.current.stop();
        flangerLfoNodeRef.current.disconnect();
        flangerLfoNodeRef.current = null;
      }
      
      if (delayNodeRef.current) {
        delayNodeRef.current.disconnect();
        delayNodeRef.current = null;
      }
      
      if (flangerLfoGainNodeRef.current) {
        flangerLfoGainNodeRef.current.disconnect();
        flangerLfoGainNodeRef.current = null;
      }
      
      if (flangerFeedbackNodeRef.current) {
        flangerFeedbackNodeRef.current.disconnect();
        flangerFeedbackNodeRef.current = null;
      }
      
      if (flangerMixNodeRef.current) {
        flangerMixNodeRef.current.disconnect();
        flangerMixNodeRef.current = null;
      }
      
      if (flangerDryNodeRef.current) {
        flangerDryNodeRef.current.disconnect();
        flangerDryNodeRef.current = null;
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