import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

export const REACTION_EMOJIS = ["\uD83D\uDC4D", "\u2764\uFE0F", "\uD83D\uDE02", "\uD83D\uDE2E", "\uD83D\uDE22", "\uD83D\uDD25"];

/** Approximate height of the pill bar (padding + emoji); used for window positioning. */
export const REACTION_PICKER_BAR_HEIGHT = 48;
export const REACTION_PICKER_BAR_WIDTH_EST = 260;

type Props = {
  onPick: (emoji: string) => void;
  align?: "start" | "end";
  position?: "above" | "below";
  /**
   * When set, the bar is placed with window-absolute coordinates (e.g. inside a Modal).
   * In that case `align` and `position` are ignored.
   */
  floatingFrame?: Pick<ViewStyle, "top" | "left" | "right">;
};

/**
 * Emoji bar anchored to a relatively-positioned parent (the bubble cluster),
 * or to the screen when `floatingFrame` is passed (Modal overlay).
 */
export function ReactionPicker({ onPick, align = "start", position = "above", floatingFrame }: Props) {
  const anchoredStyle: StyleProp<ViewStyle> = floatingFrame
    ? ([styles.wrapper, floatingFrame] as StyleProp<ViewStyle>)
    : [
        styles.wrapper,
        position === "above" ? styles.posAbove : styles.posBelow,
        align === "end" ? styles.alignEnd : styles.alignStart,
      ];

  return (
    <View pointerEvents="box-none" style={anchoredStyle}>
      <View style={styles.bar}>
        {REACTION_EMOJIS.map((emoji) => (
          <Pressable
            key={emoji}
            onPress={() => onPick(emoji)}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            accessibilityLabel={`React with ${emoji}`}
          >
            <Text style={styles.emoji}>{emoji}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    zIndex: 2,
    elevation: 12,
  },
  posAbove: {
    bottom: "100%",
    marginBottom: 6,
  },
  posBelow: {
    top: "100%",
    marginTop: 6,
  },
  alignStart: {
    left: 0,
  },
  alignEnd: {
    right: 0,
  },
  bar: {
    flexDirection: "row",
    backgroundColor: "#ffffff",
    borderRadius: 999,
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
    elevation: 12,
  },
  button: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  buttonPressed: {
    backgroundColor: "#f3f4f6",
  },
  emoji: {
    fontSize: 20,
  },
});
