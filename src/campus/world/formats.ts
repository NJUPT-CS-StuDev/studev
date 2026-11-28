import { SEARCH_BUNDLE_FORMAT } from 'wasm-search';
import { MODELS_FORMAT } from '../map/model/packing';
import type { ReleaseFormats } from './release';

/** The encodings this build reads. A release in any other is one only a newer build can use: the site waits for it,
 * and an installed app that finds it asks to be updated. */
export const FORMATS: ReleaseFormats = { search: SEARCH_BUNDLE_FORMAT, models: MODELS_FORMAT };

export const readsFormats = (formats: ReleaseFormats) => formats.search === FORMATS.search && formats.models === FORMATS.models;
