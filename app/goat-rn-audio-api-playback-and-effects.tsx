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

// Effect configuration
const FILTER_TYPE: BiquadFilterType = 'highpass'; // Change to 'lowpass' to test low-pass filter

const MAX_ROTATE_Y_DEGREES = 45; // Max rotation angle around Y axis
const MAX_ROTATE_X_DEGREES = 30; // Max rotation angle around X axis

// LFO parameters for volume modulation
const LFO_MIN_FREQ = 0.5; // Min LFO frequency (Hz)
const LFO_MAX_FREQ = 20;   // Max LFO frequency (Hz)
const LFO_MIN_DEPTH = 0;  // Min LFO depth (no effect at center)
const LFO_MAX_DEPTH = 1; // Max LFO depth (30% volume modulation at top)
const BASE_GAIN = 0.7; // Base volume level

// Filter parameters for lower Y-axis
const FILTER_MIN_FREQ = 20;      // Min filter frequency (20Hz - no filtering)
const FILTER_MAX_FREQ = 8000;    // Max filter frequency (8kHz - heavy filtering)
const FILTER_LFO_MIN_FREQ = 0.2; // Min filter LFO frequency
const FILTER_LFO_MAX_FREQ = 25;   // Max filter LFO frequency
const FILTER_Q = 1;              // Filter resonance
const FILTER_LFO_DEPTH_MIN = 500;  // No LFO modulation at center
const FILTER_LFO_DEPTH_MAX = 4000; // Max LFO sweep range (±3kHz)

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

  // High-pass filter effect nodes
  const filterNodeRef = useRef<BiquadFilterNode | null>(null);
  const filterLfoNodeRef = useRef<OscillatorNode | null>(null);
  const filterLfoGainNodeRef = useRef<GainNode | null>(null);

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
    if (normalizedX < 0.25) {
      // Leftmost quarter: very slow playback from 0.05x to 0.5x
      // Note: Web Audio API doesn't support negative playback rates for reverse
      const slowIntensity = normalizedX / 0.25; // 0 to 1
      rate = 0.05 + slowIntensity * 0.45; // 0.05 to 0.5
    } else if (normalizedX < 0.5) {
      // Left half (excluding leftmost quarter): slow down from 0.5x to 1x
      const slowIntensity = (normalizedX - 0.25) / 0.25; // 0 to 1
      rate = 0.5 + slowIntensity * 0.5; // 0.5 to 1
    } else {
      // Right half: speed up from 1x to 3x
      const speedIntensity = (normalizedX - 0.5) / 0.5; // 0 to 1
      rate = 1 + speedIntensity * 2; // 1 to 3
    }
    
    return Math.max(0.05, Math.min(3, rate));
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

  // Calculate filter parameters based on Y position (lower half only)
  const calculateFilterParams = (normalizedY: number) => {
    if (normalizedY >= 0) {
      // Upper half or center - no filter effect
      return { 
        baseFreq: FILTER_TYPE === 'lowpass' ? FILTER_MAX_FREQ : FILTER_MIN_FREQ, 
        lfoFreq: FILTER_LFO_MIN_FREQ, 
        lfoDepth: FILTER_LFO_DEPTH_MIN,
        intensity: 0 
      };
    }
    
    // Lower half - scale from 0 to 1 (absolute value since normalizedY is negative)
    const intensity = Math.abs(normalizedY); // 0 at center, 1 at bottom
    
    let baseFreq;
    if (FILTER_TYPE === 'lowpass') {
      // For low-pass: start high (no filtering) and go low (heavy filtering)
      baseFreq = FILTER_MAX_FREQ - (intensity * (FILTER_MAX_FREQ - FILTER_MIN_FREQ));
    } else {
      // For high-pass: start low (no filtering) and go high (heavy filtering)  
      baseFreq = FILTER_MIN_FREQ + (intensity * (FILTER_MAX_FREQ - FILTER_MIN_FREQ));
    }
    
    const lfoFreq = FILTER_LFO_MIN_FREQ + (intensity * (FILTER_LFO_MAX_FREQ - FILTER_LFO_MIN_FREQ));
    const lfoDepth = intensity * FILTER_LFO_DEPTH_MAX; // LFO modulates filter frequency
    
    return { baseFreq, lfoFreq, lfoDepth, intensity };
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
        
        // Clean up filter nodes
        if (filterLfoNodeRef.current) {
          filterLfoNodeRef.current.stop();
          filterLfoNodeRef.current.disconnect();
        }
        if (filterNodeRef.current) {
          filterNodeRef.current.disconnect();
        }
        if (filterLfoGainNodeRef.current) {
          filterLfoGainNodeRef.current.disconnect();
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
        
        // Filter nodes (for lower Y-axis)
        const filterNode = audioContext.createBiquadFilter();
        filterNode.type = FILTER_TYPE;
        filterNode.Q.setValueAtTime(FILTER_Q, audioContext.currentTime);
        
        const filterLfo = audioContext.createOscillator();
        filterLfo.type = 'sine';
        const filterLfoGain = audioContext.createGain();
        
        // Set initial playback rate based on X position
        const initialRate = calculatePlaybackRate(event.x, containerSize.width);
        newPlayerNode.playbackRate.setValueAtTime(initialRate, audioContext.currentTime);
        
        // Set initial effect parameters based on Y position
        const normalizedY = getNormalizedYCentered(event.y, containerSize.height);
        const lfoParams = calculateLFOParams(normalizedY);
        const filterParams = calculateFilterParams(normalizedY);
        
        // Configure tremolo LFO
        lfoNode.frequency.setValueAtTime(lfoParams.frequency, audioContext.currentTime);
        lfoGain.gain.setValueAtTime(lfoParams.depth, audioContext.currentTime);
        
        // Configure filter
        filterNode.frequency.setValueAtTime(filterParams.baseFreq, audioContext.currentTime);
        filterLfo.frequency.setValueAtTime(filterParams.lfoFreq, audioContext.currentTime);
        filterLfoGain.gain.setValueAtTime(filterParams.lfoDepth, audioContext.currentTime);
        
        // Connect the audio graph
        // Main signal path: Player → MainGain → Filter → Destination
        newPlayerNode.connect(mainGain);
        mainGain.connect(filterNode);
        filterNode.connect(audioContext.destination);
        
        // Filter LFO modulates filter frequency
        if (filterParams.lfoDepth > 0) {
          filterLfo.connect(filterLfoGain);
          filterLfoGain.connect(filterNode.frequency);
        }
        
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
        filterNodeRef.current = filterNode;
        filterLfoNodeRef.current = filterLfo;
        filterLfoGainNodeRef.current = filterLfoGain;
        
        // Start audio
        lfoNode.start(audioContext.currentTime);
        filterLfo.start(audioContext.currentTime);
        newPlayerNode.start(audioContext.currentTime);
        
        console.log("[Gesture] Sound started. Rate:", initialRate, "LFO:", lfoParams, "Filter:", filterParams);
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
        const filterParams = calculateFilterParams(normalizedY);
        
        // Update tremolo LFO (upper Y-axis)
        lfoNodeRef.current.frequency.setValueAtTime(lfoParams.frequency, audioContext.currentTime);
        lfoGainNodeRef.current.gain.setValueAtTime(lfoParams.depth, audioContext.currentTime);
        
        // Update filter parameters (lower Y-axis)
        if (filterNodeRef.current && filterLfoNodeRef.current && filterLfoGainNodeRef.current) {
          filterNodeRef.current.frequency.setValueAtTime(filterParams.baseFreq, audioContext.currentTime);
          filterLfoNodeRef.current.frequency.setValueAtTime(filterParams.lfoFreq, audioContext.currentTime);
          filterLfoGainNodeRef.current.gain.setValueAtTime(filterParams.lfoDepth, audioContext.currentTime);
          
          // Handle filter LFO connection/disconnection based on depth
          if (filterParams.lfoDepth > 0) {
            try {
              filterLfoNodeRef.current.connect(filterLfoGainNodeRef.current);
              filterLfoGainNodeRef.current.connect(filterNodeRef.current.frequency);
            } catch (e) {
              // Already connected
            }
          } else {
            try {
              filterLfoGainNodeRef.current.disconnect(filterNodeRef.current.frequency);
            } catch (e) {
              // Already disconnected
            }
          }
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
      
      if (filterLfoNodeRef.current) {
        filterLfoNodeRef.current.stop();
        filterLfoNodeRef.current.disconnect();
        filterLfoNodeRef.current = null;
      }
      
      if (filterNodeRef.current) {
        filterNodeRef.current.disconnect();
        filterNodeRef.current = null;
      }
      
      if (filterLfoGainNodeRef.current) {
        filterLfoGainNodeRef.current.disconnect();
        filterLfoGainNodeRef.current = null;
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