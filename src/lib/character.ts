export const REFERENCE_VIEWS = ["side", "front", "back"] as const;
export type ReferenceView = (typeof REFERENCE_VIEWS)[number];
export const REFERENCE_LABELS: Record<ReferenceView, string> = {
  side: "Side →", front: "Front", back: "Back",
};
export type ImageSource = (
  | { kind: "reference"; view: ReferenceView }
  | { kind: "animation"; animationId: string; edge: "first" | "last" }
) & { revision?: string };

export interface ImageSourceOption {
  source: ImageSource;
  label: string;
  url: string;
}

export function sourceKey(source: ImageSource | null): string {
  if (!source) return "";
  const identity = source.kind === "reference"
    ? `reference:${source.view}` : `animation:${source.animationId}:${source.edge}`;
  return source.revision ? `${identity}:${source.revision}` : identity;
}
