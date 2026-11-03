import Svg, { Circle, Line, Path, Polyline, Rect } from "react-native-svg";

export type IconName =
  | "home" | "transactions" | "budgets" | "planning" | "insights" | "assistant"
  | "bell" | "plus" | "eye" | "edit" | "globe" | "send" | "warning" | "settings"
  | "wallet" | "savings" | "credit-card" | "target" | "chevron-right" | "trash"
  | "search" | "calendar" | "close" | "refresh" | "back";

export function Icon({
  name, size = 22, color = "#A1A1AA", strokeWidth = 1.9,
}: {
  name: IconName; size?: number; color?: string; strokeWidth?: number;
}) {
  const common = {
    stroke: color, strokeWidth,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none",
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden={true}>
      {name === "home" ? <><Path {...common} d="M3 10.8 12 3l9 7.8" /><Path {...common} d="M5.5 9.8V21h13V9.8" /><Path {...common} d="M9.5 21v-6h5v6" /></>
      : name === "transactions" ? <><Line {...common} x1="5" y1="7" x2="19" y2="7" /><Line {...common} x1="5" y1="12" x2="19" y2="12" /><Line {...common} x1="5" y1="17" x2="15" y2="17" /></>
      : name === "budgets" ? <><Rect {...common} x="4" y="4" width="16" height="16" rx="3" /><Path {...common} d="M8 16v-4M12 16V8M16 16v-6" /></>
      : name === "planning" ? <><Circle {...common} cx="12" cy="12" r="8.5" /><Path {...common} d="M12 7v5l3.5 2" /></>
      : name === "insights" ? <><Path {...common} d="M5 19V5M5 19h14" /><Polyline {...common} points="7,15 10.5,11 13,13 18,7" /></>
      : name === "assistant" ? <><Path {...common} d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" /><Path {...common} d="m18 15 .9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15Z" /></>
      : name === "bell" ? <><Path {...common} d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><Path {...common} d="M10 21h4" /></>
      : name === "plus" ? <><Line {...common} x1="12" y1="5" x2="12" y2="19" /><Line {...common} x1="5" y1="12" x2="19" y2="12" /></>
      : name === "eye" ? <><Path {...common} d="M2.5 12s3.4-5 9.5-5 9.5 5 9.5 5-3.4 5-9.5 5-9.5-5-9.5-5Z" /><Circle {...common} cx="12" cy="12" r="2.5" /></>
      : name === "edit" ? <><Path {...common} d="m4 16.5-.8 3.8 3.8-.8L18 8.5 15.5 6 4 16.5Z" /><Path {...common} d="m14.5 7 2.5 2.5M17.2 4.3l2.5 2.5" /></>
      : name === "globe" ? <><Circle {...common} cx="12" cy="12" r="8.5" /><Path {...common} d="M3.5 12h17M12 3.5c2.3 2.4 3.2 5.2 3.2 8.5S14.3 18.1 12 20.5c-2.3-2.4-3.2-5.2-3.2-8.5S9.7 5.9 12 3.5Z" /></>
      : name === "send" ? <><Path {...common} d="m4 4 16 8-16 8 3.2-7L4 4Z" /><Line {...common} x1="7.2" y1="13" x2="15" y2="12" /></>
      : name === "warning" ? <><Path {...common} d="m12 4 8 14H4L12 4Z" /><Line {...common} x1="12" y1="9" x2="12" y2="13" /><Line {...common} x1="12" y1="16" x2="12" y2="16" /></>
      : name === "settings" ? <><Circle {...common} cx="12" cy="12" r="3" /><Path {...common} d="M19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-1.5 1.5-.1-.1a1.8 1.8 0 0 0-2-.4 1.8 1.8 0 0 0-1 1.7V20h-2.2v-.2a1.8 1.8 0 0 0-1-1.7 1.8 1.8 0 0 0-2 .4l-.1.1-1.5-1.5.1-.1a1.8 1.8 0 0 0 .4-2 1.8 1.8 0 0 0-1.7-1H5.1V11.8h.2a1.8 1.8 0 0 0 1.7-1 1.8 1.8 0 0 0-.4-2l-.1-.1L8 7.2l.1.1a1.8 1.8 0 0 0 2 .4 1.8 1.8 0 0 0 1-1.7V5.8h2.2V6a1.8 1.8 0 0 0 1 1.7 1.8 1.8 0 0 0 2-.4l.1-.1L17.9 8l-.1.1a1.8 1.8 0 0 0-.4 2 1.8 1.8 0 0 0 1.7 1h.2v2.2h-.2a1.8 1.8 0 0 0-1.7 1Z" /></>
      : name === "wallet" ? <><Path {...common} d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 17.5V6.5Z" /><Path {...common} d="M4 8h14.5a1.5 1.5 0 0 1 0 3H16" /></>
      : name === "savings" ? <><Path {...common} d="M5 8.5 7 6h7l3 2.5H20v7l-2 1.5H7l-2-1.5V8.5Z" /><Line {...common} x1="8" y1="11" x2="16" y2="11" /><Line {...common} x1="8" y1="14" x2="13" y2="14" /></>
      : name === "credit-card" ? <><Rect {...common} x="3.5" y="5.5" width="17" height="13" rx="2" /><Line {...common} x1="3.5" y1="9" x2="20.5" y2="9" /><Line {...common} x1="7" y1="14" x2="11" y2="14" /></>
      : name === "target" ? <><Circle {...common} cx="12" cy="12" r="8.5" /><Circle {...common} cx="12" cy="12" r="4.5" /><Circle cx="12" cy="12" r="1.5" fill={color} stroke="none" /></>
      : name === "chevron-right" ? <Path {...common} d="m9 5 7 7-7 7" />
      : name === "trash" ? <><Path {...common} d="M5 7h14M10 11v5M14 11v5M7 7l1 13h8l1-13M9 7l1-3h4l1 3" /></>
      : name === "search" ? <><Circle {...common} cx="11" cy="11" r="6.5" /><Line {...common} x1="16" y1="16" x2="20" y2="20" /></>
      : name === "calendar" ? <><Rect {...common} x="4" y="5" width="16" height="15" rx="2" /><Line {...common} x1="8" y1="3.5" x2="8" y2="7" /><Line {...common} x1="16" y1="3.5" x2="16" y2="7" /><Line {...common} x1="4" y1="9" x2="20" y2="9" /></>
      : name === "refresh" ? <><Path {...common} d="M20 11a8 8 0 0 0-14.7-4.2L4 9" /><Path {...common} d="M4 5v4h4" /><Path {...common} d="M4 13a8 8 0 0 0 14.7 4.2L20 15" /><Path {...common} d="M20 19v-4h-4" /></>
      : name === "back" ? <><Path {...common} d="M19 12H5" /><Path {...common} d="m11 6-6 6 6 6" /></>
      : <><Line {...common} x1="6" y1="6" x2="18" y2="18" /><Line {...common} x1="18" y1="6" x2="6" y2="18" /></>}
    </Svg>
  );
}
