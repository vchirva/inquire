// Brand logo + product name. Single source of truth.
// theme: 'light' (default) for dark backgrounds (white logo)
//        'dark' for light backgrounds (black logo)

export function brandLogo({ theme = 'light', size = 'normal', showProduct = true } = {}) {
  const src = theme === 'dark' ? 'img/sigma-logo-dark.svg' : 'img/sigma-logo-light.svg';
  const sizeClass = size === 'small' ? ' sigma-logo--small' : (size === 'large' ? ' sigma-logo--large' : '');
  return `
    <img class="sigma-logo${sizeClass}" src="${src}" alt="Sigma Software" />
    ${showProduct ? `<span class="logo-sub">Inquire</span>` : ''}
  `;
}
