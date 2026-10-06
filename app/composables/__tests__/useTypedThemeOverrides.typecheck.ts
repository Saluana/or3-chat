import type { NuxtUIButtonOverrides, NuxtUIInputOverrides } from '../useTypedThemeOverrides';
import type { ButtonProps, InputProps } from '@nuxt/ui';

type Assert<T extends true> = T;
type Includes<T, Value> = Value extends NonNullable<T> ? true : false;
type Excludes<T, Value> = Value extends NonNullable<T> ? false : true;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

// Checked by the ordinary application typecheck; no runtime test or runtime imports.
export type TypedThemeRecipeContract = [
    Assert<Includes<NuxtUIButtonOverrides['size'], 'workspace'>>,
    Assert<Includes<NuxtUIButtonOverrides['size'], 'touch'>>,
    Assert<Includes<NuxtUIButtonOverrides['size'], 'modal'>>,
    Assert<Includes<NuxtUIButtonOverrides['color'], 'on-surface'>>,
    Assert<Includes<NuxtUIInputOverrides['size'], 'workspace'>>,
    Assert<Includes<NuxtUIInputOverrides['variant'], 'modal'>>,
    Assert<Excludes<NuxtUIButtonOverrides['size'], 'made-up-size'>>,
    Assert<Excludes<NuxtUIButtonOverrides['color'], 'made-up-color'>>,
    Assert<Excludes<NuxtUIInputOverrides['variant'], 'made-up-variant'>>,
    Assert<Equal<NuxtUIButtonOverrides['size'], ButtonProps['size']>>,
    Assert<Equal<NuxtUIButtonOverrides['variant'], ButtonProps['variant']>>,
    Assert<Equal<NuxtUIButtonOverrides['color'], ButtonProps['color']>>,
    Assert<Equal<NuxtUIInputOverrides['size'], InputProps['size']>>,
    Assert<Equal<NuxtUIInputOverrides['variant'], InputProps['variant']>>,
];
