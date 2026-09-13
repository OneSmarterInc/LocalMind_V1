import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleProp, ViewStyle } from "react-native";
import { gradients } from "./theme";

type Direction = "horizontal" | "vertical" | "diagonal";

const DIRS: Record<Direction, { start: { x: number; y: number }; end: { x: number; y: number } }> = {
  horizontal: { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } },
  vertical: { start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 } },
  diagonal: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
};

/**
 * Thin wrapper so screens never import expo-linear-gradient directly and all
 * gradient stops live in theme.ts. `name` picks a preset; `colors` overrides.
 */
export function Gradient({
  name = "brand",
  colors,
  direction = "diagonal",
  style,
  children,
}: {
  name?: keyof typeof gradients;
  colors?: readonly [string, string, ...string[]];
  direction?: Direction;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const stops = (colors ?? gradients[name]) as [string, string, ...string[]];
  return (
    <LinearGradient colors={stops} {...DIRS[direction]} style={style}>
      {children}
    </LinearGradient>
  );
}
