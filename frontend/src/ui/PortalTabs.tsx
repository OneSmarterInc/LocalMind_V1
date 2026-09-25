import { createBottomTabNavigator, type BottomTabNavigationEventMap, type BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import type { ParamListBase, TabNavigationState } from '@react-navigation/native';
import { withLayoutContext, type Href } from 'expo-router';

// Expo's stock Tabs wrapper overwrites UNSTABLE_router. Use its public layout
// integration directly so the portal's router actually receives the actions.
// ShellTabBar handles href=null visibility and all sidebar navigation.
const Navigator = createBottomTabNavigator().Navigator;
export const PortalTabs = withLayoutContext<
  BottomTabNavigationOptions & { href?: Href | null },
  typeof Navigator,
  TabNavigationState<ParamListBase>,
  BottomTabNavigationEventMap
>(Navigator);
