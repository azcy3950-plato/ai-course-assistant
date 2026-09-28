"use client";

import { useId, type CSSProperties } from "react";
import styles from "./wenshui-avatar.module.css";

export type WenshuiMood = "idle" | "thinking" | "question" | "celebrate" | "wave" | "petted" | "tea" | "sleeping" | "reading" | "walking" | "carried";

export type WenshuiAvatarProps = {
  mood?: WenshuiMood;
  size?: number;
  className?: string;
  look?: {x: number; y: number};
};

const moodLabels: Record<WenshuiMood, string> = {
  idle: "问水先生，一起发现知识之间的联系",
  thinking: "问水先生正在思考",
  question: "问水先生邀请你想一想",
  celebrate: "问水先生为你的进步喝彩",
  wave: "问水先生向你挥手",
  petted: "问水先生开心地蹭了蹭你的手",
  tea: "问水先生正在喝茶",
  sleeping: "问水先生正在打盹",
  reading: "问水先生正陪你看书",
  walking: "问水先生正在散步",
  carried: "问水先生被轻轻拎起来了",
};

/** Original vector character: a kindly water scholar with a knowledge scroll. */
export default function WenshuiAvatar({
  mood = "idle",
  size = 112,
  className = "",
  look = {x: 0, y: 0},
}: WenshuiAvatarProps) {
  const id = `wenshui-${useId().replace(/:/g, "")}`;
  const paint = (name: string) => `url(#${id}-${name})`;

  return (
    <span
      className={`${styles.avatar} ${styles[mood]} ${className}`}
      style={{ "--wenshui-size": `${size}px`, "--look-x": `${look.x}px`, "--look-y": `${look.y}px` } as CSSProperties}
      data-wenshui-mood={mood}
    >
      <svg
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-labelledby={`${id}-title`}
        focusable="false"
      >
        <title id={`${id}-title`}>{moodLabels[mood]}</title>
        <defs>
          <linearGradient id={`${id}-robe`} x1="76" y1="102" x2="137" y2="169" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFEF5" />
            <stop offset="1" stopColor="#E8DFC6" />
          </linearGradient>
          <linearGradient id={`${id}-skin`} x1="81" y1="42" x2="122" y2="113" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFDEBC" />
            <stop offset="1" stopColor="#EAB088" />
          </linearGradient>
          <linearGradient id={`${id}-hair`} x1="74" y1="34" x2="130" y2="106" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFDF0" />
            <stop offset="1" stopColor="#CCD3C3" />
          </linearGradient>
          <linearGradient id={`${id}-shawl`} x1="74" y1="104" x2="110" y2="157" gradientUnits="userSpaceOnUse">
            <stop stopColor="#D28B66" />
            <stop offset="1" stopColor="#A95E43" />
          </linearGradient>
          <linearGradient id={`${id}-scroll`} x1="111" y1="127" x2="135" y2="164" gradientUnits="userSpaceOnUse">
            <stop stopColor="#438D7C" />
            <stop offset="1" stopColor="#246957" />
          </linearGradient>
          <radialGradient id={`${id}-halo`} cx="0" cy="0" r="1" gradientTransform="translate(101 104) rotate(90) scale(84)" gradientUnits="userSpaceOnUse">
            <stop stopColor="#DBEBE1" stopOpacity=".86" />
            <stop offset="1" stopColor="#DBEBE1" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle className={styles.halo} cx="101" cy="103" r="82" fill={paint("halo")} />
        <ellipse className={styles.shadow} cx="102" cy="179" rx="44" ry="7" fill="#193F32" opacity=".12" />

        <g className={styles.figure} stroke="#486151" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          {/* Small sandals anchor the soft, rounded silhouette. */}
          <g className={styles.leftFoot}><path d="M79 162 76 174c1 5 18 5 21 1l-2-12" fill="#C89269" /><path d="m79 171 15 1" stroke="#755C43" /></g>
          <g className={styles.rightFoot}><path d="m111 163-1 12c3 4 19 4 21-1l-5-12" fill="#C89269" /><path d="m113 172 15-1" stroke="#755C43" /></g>
          <path d="M77 104c-13 5-15 16-15 29l4 26c17 14 55 17 73 3l-1-29c-2-17-9-26-23-30Z" fill={paint("robe")} />
          <path d="M101 117c-6 15-7 33-7 47m18-31 6 29m-44-24 3 20" stroke="#BEBEA2" strokeWidth="2" />
          <path d="M77 103c7 10 13 17 23 22l-6 37c-15-2-24-7-28-13l-1-25c1-9 5-16 12-21Z" fill={paint("shawl")} />
          <path d="m75 113 15 14-6 30" stroke="#E5AD82" strokeWidth="2" />
          <path d="M118 104c8 5 14 12 15 24l-8 7-15-22Z" fill="#FAF6E8" />

          {/* Right hand changes its gesture for a question or celebration. */}
          <g className={styles.gesture}>
            {mood === "question" || mood === "celebrate" || mood === "wave" || mood === "carried" ? (
              <>
                <path d="m68 115-14-11-7 10 14 18c7 2 13-8 7-17Z" fill="#CF8B66" />
                <path d="M54 111c-7 1-12-2-14-7l-3-10c0-3 5-4 6 0l2 6-1-18c0-5 6-5 7-1l2 16 3-4c3-3 7 0 5 4l-3 9Z" fill={paint("skin")} />
                <path d="m46 102 7 1" stroke="#BE8865" strokeWidth="1.7" />
              </>
            ) : (
              <>
                <path d="m69 116-9 9c-4 6 0 14 7 13l14-8" fill="#D29570" />
                <path d="M69 126c-3-5 0-10 4-10l6 4 5-1c4 0 6 4 4 7l-8 9c-5 2-9-3-11-9Z" fill={paint("skin")} />
                <path d="m76 124 6 3" stroke="#BF8A68" strokeWidth="1.7" />
              </>
            )}
          </g>

          {/* A water-drop brooch, distinct from any existing mascot. */}
          <path d="M89 109c0-4 5-8 5-8s5 4 5 8a5 5 0 0 1-10 0Z" fill="#57AA96" stroke="#356C58" strokeWidth="1.6" />
          <path d="m92 108 1-2" stroke="#D8FFF0" strokeWidth="1.5" />

          <g className={styles.gaze}><g className={styles.head}>
            {/* The softly scalloped hair and beard are drawn for this project. */}
            <path d="M62 72c-8-5-9-17-3-22-2-8 4-17 12-17 1-10 11-14 19-10 7-8 17-7 24-1 9-3 20 2 22 11 11 1 18 10 14 20 9 8 8 20 1 25l-10 17-77-1Z" fill={paint("hair")} />
            <path d="M69 40c5-7 12-8 18-6m28-2c7 0 12 4 13 10m16 13c1 5-1 10-5 12" stroke="#B2BDAD" strokeWidth="2" />
            <ellipse cx="61" cy="79" rx="9" ry="12" fill={paint("skin")} />
            <ellipse cx="142" cy="79" rx="9" ry="12" fill={paint("skin")} />
            <path d="m59 77 4 4m81-4-4 4" stroke="#C18D6C" strokeWidth="1.8" />
            <path d="M63 64c1-15 16-27 38-27s39 12 39 29l-2 21c-2 18-20 29-36 29S67 103 64 87Z" fill={paint("skin")} />
            <path d="M62 69c-4-12 3-24 14-26 0 8-3 17-10 20m74 7c5-11-1-23-12-28 1 9 3 18 10 22" fill={paint("hair")} />
            <path d="M73 65c4-4 10-5 15-2m29-1c5-2 10 0 13 4" stroke="#76806B" strokeWidth="4" />
            <g className={['celebrate', 'petted', 'tea', 'sleeping', 'carried'].includes(mood) ? undefined : styles.eyes} stroke="#38483C" strokeWidth="3.2">
              {mood === "celebrate" || mood === "petted" || mood === "tea" ? (
                <><path d="M76 77q6-7 12 0" /><path d="M115 77q6-7 12 0" /></>
              ) : mood === "sleeping" ? (
                <><path d="M76 75q6 5 12 0" /><path d="M115 75q6 5 12 0" /></>
              ) : mood === "carried" ? (
                <><ellipse cx="82" cy="77" rx="2.5" ry="4" fill="#38483C"/><ellipse cx="120" cy="77" rx="2.5" ry="4" fill="#38483C"/></>
              ) : mood === "thinking" ? (
                <><path d="m77 76 9-1" /><path d="m115 75 9 1" /></>
              ) : (
                <><path d="M82 74v5" /><path d="M120 74v5" /></>
              )}
            </g>
            <ellipse cx="76" cy="86" rx="7" ry="4" fill="#E89E85" opacity=".55" stroke="none" />
            <ellipse cx="129" cy="86" rx="7" ry="4" fill="#E89E85" opacity=".55" stroke="none" />
            <path d="M66 88c5 4 10 4 15 1 8 9 16 10 22 7 7 3 14 2 21-7 5 3 10 3 14-1 3 8-2 15-8 17-1 8-8 12-15 12-5 8-19 10-26 3-9 0-15-5-16-11-8-3-11-12-7-21Z" fill={paint("hair")} />
            <path d="M94 99q8 7 16 0" stroke="#786A58" strokeWidth="2" />
            <path d="M101 88c-9-7-18-4-22 3 7 8 16 5 22 0 6 5 15 8 23 0-5-7-14-10-23-3Z" fill="#FFFBEA" stroke="#ABB5A1" strokeWidth="1.6" />
            <path d="M95 82c0 5 12 6 13 1 1-4-3-8-6-8-3 0-6 3-7 7Z" fill="#EEC19B" stroke="#C4916E" strokeWidth="1.6" />
            <path d="m85 106 4 5m12-2v6m15-8-3 5" stroke="#AFB9A6" strokeWidth="1.7" />
          </g></g>

          {/* The little scroll contains a graph, rather than decorative text. */}
          <g className={styles.scroll} transform="rotate(-8 119 145)">
            <path d="M101 125h33v38h-33Z" fill={paint("scroll")} stroke="#315F4E" />
            <path d="M103 126h-5a4 4 0 0 1 0-8h36a4 4 0 0 1 0 8h-3" fill="#E8D7AB" stroke="#827B55" strokeWidth="2" />
            <path d="M103 164h-5a4 4 0 0 1 0-8h35a4 4 0 0 1 0 8Z" fill="#E8D7AB" stroke="#827B55" strokeWidth="2" />
            <path d="m109 135 14 10-13 5m13-5 4-11" stroke="#AFD6B7" strokeWidth="1.7" />
            <circle cx="109" cy="135" r="3" fill="#F3DC9B" stroke="none" />
            <circle cx="123" cy="145" r="3.5" fill="#F3DC9B" stroke="none" />
            <circle cx="110" cy="150" r="2.5" fill="#D0E7C4" stroke="none" />
            <circle cx="127" cy="134" r="2.5" fill="#D0E7C4" stroke="none" />
          </g>
          {mood !== 'tea' && <><path d="M137 133c5-1 8 3 7 7l-4 8c-3 3-8 0-8-3l3-4-4-1c-4-3-2-8 2-7Z" fill={paint("skin")} strokeWidth="2" /><path d="m137 141 4 1" stroke="#BE8865" strokeWidth="1.5" /></>}
          {mood === 'tea' && <g className={styles.teaCup}>
            <path d="M129 126q13 4 15-5l-2-13-10 2-1 12" fill={paint('robe')}/>
            <path d="M132 111q9-7 15-1l-1 8-13 3" fill={paint('skin')}/>
            <path d="M122 99h24l-2 18q-10 8-20-1Z" fill="#93B99D"/>
            <path d="M147 102q13 0 8 11l-9 2" stroke="#527E68" strokeWidth="3"/>
            <ellipse cx="134" cy="99" rx="12" ry="3" fill="#A6BA80"/>
            <g className={styles.steam} stroke="#94A99A" strokeWidth="2"><path d="M129 91q-4-4 0-8t0-8"/><path d="M139 90q-4-4 0-8"/></g>
          </g>}
          {mood === 'reading' && <g className={styles.book}>
            <path d="M78 123q12-4 24 4 12-8 24-4v31q-11-3-24 4-12-7-24-4Z" fill="#FFF5D8" stroke="#9A895E"/>
            <path d="M102 128v29m-18-25 12 3m-12 4 12 3m-12 4 12 3m12-14 12-3m-12 10 12-3m-12 10 12-3" stroke="#B4A177" strokeWidth="1.4"/>
          </g>}
        </g>

        <g className={styles.status} aria-hidden="true">
          {mood === 'sleeping' ? <g className={styles.sleepMarks} stroke="#86A1A0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M151 54h11l-11 12h11"/><path d="M166 28h16l-16 17h16"/></g>
          : mood === 'petted' ? <g className={styles.hearts} fill="#D88B96"><path d="M158 31c-12-13-24 6 0 19 24-13 12-32 0-19Z"/><path d="M40 55c-8-9-16 4 0 13 16-9 8-22 0-13Z"/></g>
          : mood === "thinking" ? (
            <>
              <circle cx="154" cy="57" r="3" fill="#BDCCB9" />
              <circle cx="162" cy="47" r="5" fill="#DCE8D7" />
              <rect x="146" y="19" width="43" height="25" rx="12.5" fill="#FAFCF5" stroke="#C3D4BE" strokeWidth="1.8" />
              <g fill="#62977B" className={styles.thinkingDots}>
                <circle cx="157" cy="32" r="2" /><circle cx="167" cy="32" r="2" /><circle cx="177" cy="32" r="2" />
              </g>
            </>
          ) : mood === "question" ? (
            <>
              <path d="M158 13h13a12 12 0 0 1 12 12v8a12 12 0 0 1-12 12h-7l-9 7 1-8a12 12 0 0 1-10-12v-7a12 12 0 0 1 12-12Z" fill="#FCF4DB" stroke="#D4B778" strokeWidth="1.8" />
              <path d="M160 25c0-6 10-7 10 0 0 4-6 3-6 7" stroke="#8D7545" strokeWidth="2.8" strokeLinecap="round" />
              <circle cx="164" cy="38" r="1.6" fill="#8D7545" />
            </>
          ) : mood === "celebrate" ? (
            <g strokeLinecap="round" strokeLinejoin="round">
              <path d="m161 22 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="#EBC767" stroke="#C49D49" strokeWidth="1.4" />
              <path d="m33 45 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#91B9A1" />
              <path d="m171 72 3-5m-138 72-5-3m104-120 3-5" stroke="#C58B68" strokeWidth="3" />
              <circle cx="173" cy="52" r="2.5" fill="#76A38A" />
            </g>
          ) : (
            <path d="m161 42 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#94B5A0" />
          )}
        </g>
      </svg>
    </span>
  );
}
