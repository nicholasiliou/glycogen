/** Built-in canvas resolution presets. Arbitrary custom sizes are also allowed. */
export interface ResolutionPreset {
  label: string;
  group: string;
  width: number;
  height: number;
  fps?: number;
}

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { label: "HD 720p", group: "Landscape", width: 1280, height: 720 },
  { label: "Full HD 1080p", group: "Landscape", width: 1920, height: 1080 },
  { label: "QHD 1440p", group: "Landscape", width: 2560, height: 1440 },
  { label: "4K UHD", group: "Landscape", width: 3840, height: 2160 },
  { label: "Cinema 2K", group: "Landscape", width: 2048, height: 1080 },
  { label: "Cinema 4K", group: "Landscape", width: 4096, height: 2160 },

  { label: "Square 1080", group: "Square", width: 1080, height: 1080 },
  { label: "Square 2048", group: "Square", width: 2048, height: 2048 },

  { label: "Portrait 1080×1920", group: "Portrait", width: 1080, height: 1920 },
  { label: "Vertical 1440×2560", group: "Portrait", width: 1440, height: 2560 },

  { label: "Instagram Post", group: "Social", width: 1080, height: 1350 },
  { label: "Instagram Story / Reel", group: "Social", width: 1080, height: 1920 },
  { label: "TikTok", group: "Social", width: 1080, height: 1920 },
  { label: "YouTube Thumbnail", group: "Social", width: 1280, height: 720 },
  { label: "YouTube Shorts", group: "Social", width: 1080, height: 1920 },
  { label: "X / Twitter Post", group: "Social", width: 1600, height: 900 },
  { label: "Facebook Cover", group: "Social", width: 1640, height: 856 },
];

export const PREVIEW_QUALITIES = [
  { label: "Full", value: 1 },
  { label: "Half", value: 0.5 },
  { label: "Third", value: 1 / 3 },
  { label: "Quarter", value: 0.25 },
] as const;
