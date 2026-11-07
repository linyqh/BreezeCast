/** CLDR plural categories other than `other`, which every locale must provide. */
type PluralCategory = "zero" | "one" | "two" | "few" | "many";
type PluralKey = `${string}_${PluralCategory}`;

/**
 * Shape a translation file must have: the exact key tree of the source locale,
 * except plural variants, which differ per language. Only `_other` is required
 * (e.g. Chinese has no `_one`); languages with more categories may add them.
 */
export type Locale<T> = T extends string
  ? string
  : { [K in keyof T as K extends PluralKey ? never : K]: Locale<T[K]> } & { [K in keyof T as K extends PluralKey ? K : never]?: string } & {
      [K in PluralKey]?: string;
    };
