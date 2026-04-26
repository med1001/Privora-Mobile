import { GestureResponderEvent, Pressable, Text } from "react-native";

type HeaderButtonProps = {
  onPress: (event: GestureResponderEvent) => void;
  label: string;
};

export function HeaderButton({ onPress, label }: HeaderButtonProps) {
  return (
    <Pressable onPress={onPress} style={{ paddingVertical: 6, paddingHorizontal: 8 }}>
      <Text style={{ color: "#2563eb", fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}
