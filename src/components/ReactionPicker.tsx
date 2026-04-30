import { Pressable, StyleSheet, Text, View } from "react-native";

export const REACTION_EMOJIS = ["\uD83D\uDC4D", "\u2764\uFE0F", "\uD83D\uDE02", "\uD83D\uDE2E", "\uD83D\uDE22", "\uD83D\uDD25"];

type Props = {
  onPick: (emoji: string) => void;
  align?: "start" | "end";
  position?: "above" | "below";
};

export function ReactionPicker({ onPick, align = "start", position = "above" }: Props) {
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        position === "above" ? styles.posAbove : styles.posBelow,
        align === "end" ? styles.alignEnd : styles.alignStart,
      ]}
    >
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
    zIndex: 50,
  },
  posAbove: {
    top: -46,
  },
  posBelow: {
    bottom: -46,
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
    elevation: 6,
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
