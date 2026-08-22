export interface ModelLook {
  skin: string;
  hair: string;
  outfit: string;
  style: 'dress' | 'suit' | 'casual';
}

export interface ModelMeta {
  id: string;
  /** 'capture' entries are real imported splats (import-real-splats.mjs);
   *  absent/'placeholder' entries are synthetic (generate-placeholder-splats.mjs). */
  source?: 'capture' | 'placeholder';
  /** Which talent board the model belongs to; untagged models (e.g. the
   *  object-capture test models) appear on every board. */
  gender?: 'female' | 'male';
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
