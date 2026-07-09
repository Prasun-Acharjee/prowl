import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { useTheme } from '../context/ThemeContext';
import { MapScreen } from '../screens/MapScreen';
import { CameraScreen } from '../screens/CameraScreen';
import { PetDetailScreen } from '../screens/PetDetailScreen';
import { AddSightingScreen } from '../screens/AddSightingScreen';
import { LegalScreen } from '../screens/LegalScreen';

export type RootStackParamList = {
  Map:          undefined;
  Camera:       undefined;
  PetDetail:    { petId: string };
  AddSighting:  { petId: string; defaultLat: number; defaultLng: number };
  Legal:        undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { colors } = useTheme();

  const navTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: colors.bg,
      card:       colors.surface,
      border:     colors.border,
      text:       colors.textPrimary,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false, cardStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="Map"    component={MapScreen} />
        <Stack.Screen name="Camera" component={CameraScreen} options={{ gestureEnabled: true, animationEnabled: true }} />
        <Stack.Screen name="PetDetail"   component={PetDetailScreen} />
        <Stack.Screen name="AddSighting" component={AddSightingScreen} options={{ gestureEnabled: true, animationEnabled: true }} />
        <Stack.Screen name="Legal" component={LegalScreen} options={{ gestureEnabled: true, animationEnabled: true }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
