import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GameSocketProvider, useGame } from './src/game/useGameSocket';
import { HomeScreen } from './src/screens/HomeScreen';
import { LobbyScreen } from './src/screens/LobbyScreen';
import { GameScreen } from './src/screens/GameScreen';
import { ResultsScreen } from './src/screens/ResultsScreen';
import { theme } from './src/lib/theme';

/**
 * The flow is strictly linear (home → lobby → game → results) and every screen
 * shares one live socket, so routing off the connection's own phase is simpler
 * and less error-prone than threading a socket through navigation params.
 */
function Router() {
  const { phase } = useGame();
  switch (phase) {
    case 'lobby':
      return <LobbyScreen />;
    case 'playing':
      return <GameScreen />;
    case 'results':
      return <ResultsScreen />;
    default:
      return <HomeScreen />;
  }
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.bg }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <GameSocketProvider>
          <Router />
        </GameSocketProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
