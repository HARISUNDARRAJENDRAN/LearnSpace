const assets = {
  cloud: "/assets/craft/cloud.png",
  paperTexture: "/assets/craft/paper-texture.png",
  sheetTexture: "/assets/craft/sheet-texture.webp",
  blackPaper: "/assets/craft/black-paper.png",
  yellowPaper: "/assets/craft/yellow-paper.webp",
} as const;

function LineArt() {
  return (
    <svg className="line-art" viewBox="0 0 1440 269" preserveAspectRatio="none" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1">
        <path d="M0 0H1440" />
        <path d="M0 194.5H1440" />
        <path d="M251.5 0V269" />
        <path d="M586.5 0V269" />
        <path d="M911.5 0V269" />
        <path d="M1117.5 0V269" />
        <path d="M0 0C102 0 176 57 176 104S102 208 0 208" />
        <path d="M1440 0C1338 0 1264 57 1264 104S1338 208 1440 208" />
        <path d="M251 0C251 93 180 168 87 168" />
        <path d="M1118 0C1118 93 1189 168 1282 168" />
      </g>
    </svg>
  );
}

export function HeroCollage() {
  return (
    <div className="collage" aria-hidden="true">
      <img
        className="paper-texture"
        src={assets.paperTexture}
        alt=""
      />
      <LineArt />
      <img className="cloud cloud-left" src={assets.cloud} alt="" />
      <img className="cloud cloud-right" src={assets.cloud} alt="" />

      <div className="white-torn">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>

      <div className="purple-paper">
        <img src={assets.sheetTexture} alt="" />
      </div>

      <div className="black-paper">
        <img src={assets.blackPaper} alt="" />
      </div>

      <div className="mountain-paper">
        <div className="mountain-shadow" />
      </div>

      <div className="yellow-paper">
        <img src={assets.yellowPaper} alt="" />
      </div>
    </div>
  );
}
