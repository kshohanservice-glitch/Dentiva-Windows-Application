/**
 * Clinic branding helpers.
 *
 * The clinic's own identity (name + logo) is shown on the login screen and in
 * the dashboard header, while "Dentiva Pro" stays the identity of the software
 * product (About screen, product fallbacks, window titles).
 *
 * Nothing here hardcodes a particular clinic: every value comes from the
 * clinic settings record, with a documented fallback when nothing is configured.
 */
import type { ClinicSettings } from './types';

export const PRODUCT_NAME = 'Dentiva Pro';
/** Product fallback mark used when no clinic logo is configured. */
export const PRODUCT_MARK = 'D';
/** Fallback identity when the clinic has not configured a name yet. */
export const DEFAULT_CLINIC_NAME = 'Dental Clinic';

/** The clinic's configured name, or a neutral fallback when none is set. */
export function clinicDisplayName(clinic?: ClinicSettings | null): string {
  const name = clinic?.clinicName?.trim();
  return name ? name : DEFAULT_CLINIC_NAME;
}

/** True when a clinic logo is configured and can be rendered. */
export function hasClinicLogo(clinic?: ClinicSettings | null): boolean {
  return typeof clinic?.logoDataUrl === 'string' && clinic.logoDataUrl.startsWith('data:image/');
}
