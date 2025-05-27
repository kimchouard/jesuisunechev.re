// This file should only import and register the root. No components or exports
// should be added here.
import '@expo/metro-runtime';
import { App } from 'expo-router/build/qualified-entry';
import { renderRootComponent } from 'expo-router/build/renderRootComponent';
import { LoadCustomWasm } from 'react-native-audio-api';

// Load the custom WASM file for react-native-audio-api
LoadCustomWasm().then(() => {
  renderRootComponent(App);
});