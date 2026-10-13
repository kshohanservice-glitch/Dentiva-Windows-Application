import { useState } from 'react';
import type { ClinicSettings } from '../../shared/types';
import { PRODUCT_MARK, clinicDisplayName, hasClinicLogo } from '../../shared/branding';

/**
 * The clinic's configured logo.
 *
 * Renders the uploaded logo when one is configured. If the stored file is
 * missing, truncated or otherwise undecodable, the image load fails and the
 * product mark is shown instead — never a broken-image icon.
 */
export function ClinicLogo(props: { clinic?: ClinicSettings | null; size?: number; rounded?: number }) {
  const [broken, setBroken] = useState(false);
  const size = props.size ?? 40;
  const radius = props.rounded ?? Math.round(size / 4);
  const src = props.clinic?.logoDataUrl;

  if (hasClinicLogo(props.clinic) && src && !broken) {
    return (
      <img
        className="clinic-logo"
        src={src}
        alt=""
        width={size}
        height={size}
        style={{ borderRadius: radius }}
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <div
      className="brand-mark clinic-mark"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46), borderRadius: radius }}
      aria-hidden="true"
    >
      {PRODUCT_MARK}
    </div>
  );
}

/**
 * The clinic's configured name. Long names are ellipsised with a native
 * tooltip carrying the full value, so narrow windows never break the layout.
 */
export function ClinicName(props: { clinic?: ClinicSettings | null; className?: string }) {
  const name = clinicDisplayName(props.clinic);
  return (
    <span className={`clinic-name ${props.className ?? ''}`.trim()} title={name}>
      {name}
    </span>
  );
}
