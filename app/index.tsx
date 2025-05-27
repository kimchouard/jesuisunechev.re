import { useAudioPlayer } from 'expo-audio';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

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
    <View style={styles.container}>
      <Pressable onPress={playSound} style={styles.touchable}>
        <Image
          source={chevreImage}
          style={styles.image}
          contentFit="cover"
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  touchable: {
    flex: 1,
  },
  image: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
});
