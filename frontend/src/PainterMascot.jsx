import "./PainterMascot.css";

function PainterMascot() {
  return (
    <span className="painter-mascot" role="img" aria-label="Dancing painter">
      <svg viewBox="0 0 120 160" aria-hidden="true">
        <ellipse className="mascot-shadow" cx="60" cy="148" rx="28" ry="6" />
        <g className="mascot-dancer">
          <g className="mascot-back-arm">
            <path className="mascot-arm" d="M42 66 27 82 18 68" />
            <circle className="mascot-hand" cx="18" cy="68" r="4" />
          </g>
          <g className="mascot-front-arm">
            <path className="mascot-arm" d="m76 66 14 16 11-14" />
            <circle className="mascot-hand" cx="101" cy="68" r="4" />
          </g>
          <path className="mascot-body" d="M42 59q18-10 36 0l-4 42H46z" />
          <path className="mascot-apron" d="m45 71 31 1 5 31H40z" />
          <path className="mascot-apron-pocket" d="M51 81h18v12H51z" />
          <g className="mascot-left-leg">
            <path className="mascot-leg" d="m49 101-5 24" />
            <path className="mascot-shoe" d="M43 124q-10 0-12 7h18l2-5z" />
          </g>
          <g className="mascot-right-leg">
            <path className="mascot-leg" d="m68 101 8 22" />
            <path className="mascot-shoe" d="M76 122q10-2 15 5l-1 4H73z" />
          </g>
          <path className="mascot-neck" d="M55 51h12v12H55z" />
          <circle className="mascot-face" cx="61" cy="37" r="20" />
          <path className="mascot-hair" d="M41 37q-2-23 20-24 21 2 21 24l-7-7-4 5-7-8-8 8-7-5z" />
          <path className="mascot-hat" d="M40 26q4-17 21-17t21 17z" />
          <path className="mascot-hat-brim" d="M36 26h50q-3 7-25 7T36 26z" />
          <circle className="mascot-eye" cx="54" cy="38" r="1.6" />
          <circle className="mascot-eye" cx="68" cy="38" r="1.6" />
          <path className="mascot-smile" d="M55 46q6 6 12 0" />
          <path className="mascot-paint" d="M76 76q8-4 10 2t-6 8" />
        </g>
      </svg>
    </span>
  );
}

export default PainterMascot;