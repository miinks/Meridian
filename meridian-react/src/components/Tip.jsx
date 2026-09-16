export default function Tip({ tip }) {
  if (!tip.visible) return null;
  return (
    <div className="tip" style={{ left: `${tip.x}px`, top: `${tip.y}px` }}>
      {tip.text}
    </div>
  );
}
