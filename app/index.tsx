import { useAudioPlayer } from 'expo-audio';
import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

const chevreImage = require('../assets/images/chevre_de_verzasca.jpg');
const chevreSound = require('../assets/audio/chevre.mp3');

export default function HomeScreen() {
  const player = useAudioPlayer(chevreSound);

  const playSound = () => {
    try {
      if (player.paused) player.play();
      else  player.seekTo(0);
    } catch (error) {
      console.error("Failed to play sound:", error);
      // Handle error (e.g., show an alert to the user)
    }
  };

  return (
    <View className="flex-1 bg-black">
      <Pressable onPress={playSound} className='flex-1'>
        <Image
          source={chevreImage}
          className="w-full h-full pointer-events-none"
          contentFit="cover"
        />
      </Pressable>
    </View>
  );
}