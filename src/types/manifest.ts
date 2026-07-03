export interface ModelLook {
  skin: string;
  hair: string;
  outfit: string;
  style: 'dress' | 'suit' | 'casual';
}

export interface ModelMeta {
  id: string;
  name: string;
  agency: string;
  city: string;
  heightCm: number;
  weightKg: number;
  bustCm: number;
  waistCm: number;
  hipsCm: number;
  shoeEu: number;
  hair: string;
  eyes: string;
  bio: string;
  look: ModelLook;
}

export interface SplatEntry {
  id: string;
  splatUrl: string;
  thumbUrl: string;
  sizeBytes: number;
  meta?: ModelMeta;
}
