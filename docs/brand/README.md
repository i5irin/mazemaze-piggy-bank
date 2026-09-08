# まぜまぜ貯金箱 — Brand Specification

This document defines human-facing guidelines as the **Brand Specification** for "まぜまぜ貯金箱" (Mazemaze Piggy Bank), ensuring a consistent appearance throughout the PWA (icons, favicon, headers, store images, About, and other surfaces). Versions are managed through Git history rather than filenames or manually assigned version numbers.

For the overall Product / UI / PWA specification, see [../specification.md](../specification.md).

---

## 1. Brand Goals (Tone & Theme)

### 1.1 Themes

- Approachability
- Cuteness
- A slight association with money (without being mistaken for a financial service)
- A clean, trustworthy everyday tool (consistent with the tone of Fluent UI)

### 1.2 Impressions to Avoid

- A cheap appearance resembling bargain-store promotional signage
- Being mistaken for a bank, financial institution, or investment service (associations with buildings, safes, cards, stock charts, etc.)
- Excessive decoration (too many embellishments, too much 3D, too many colors)
- Overcrowded patterns (all-over scale-like or tile-like patterns)
- Overemphasized glass effects (such as glassmorphism) that turn the product into an "atmosphere-first app" and reduce readability

---

## 2. Naming & Copy

### 2.1 Official Japanese Name

- **まぜまぜ貯金箱**

### 2.2 English Name (Store / Display Name)

- **Mazemaze Piggy Bank**

### 2.3 Tagline (English)

- **Mix & Allocate Savings**

### 2.4 Subtitle (Japanese)

- **預金も投資も、まぜまぜ管理**

### 2.5 Naming Rules

- **As a rule, do not use abbreviations** (such as まぜ貯) to avoid a cheap impression.
- The romanized form "Mazemaze" is acceptable for "まぜまぜ" (with an audience familiar with Japanese cultural references in mind).
- Avoid standalone "Bank" wording that evokes a bank, financial institution, or financial service. Use the official English name **Mazemaze Piggy Bank** as a proper name in which "Piggy Bank" means a savings container (貯金箱).

---

## 3. Color Palette (Fixed)

### 3.1 Three Core Colors (Finalized)

- **Butter yellow**
- **White**
- **Soft gray**

> Goal: Cute without looking cheap. Keep yellow as an accent that adds warmth.

### 3.2 Usage Proportions (Recommended)

- Butter yellow: **5–15%** (accent)
- White: Base (backgrounds and whitespace)
- Soft gray: Text, shadows, and supporting elements (a trustworthy UI)

### 3.3 Usage Rules (Required)

- Do not use yellow for body text (to preserve readability and avoid a cheap appearance).
- As a rule, limit the palette to these three colors (define any exceptions separately).
- Prioritize a design that works through shape even in dark mode (color is supplementary).
- Prefer using **Butter yellow for filled areas**, and avoid relying on it alone for thin lines or small areas (supplement with shadows, borders, or area when necessary).

### 3.4 Wordmark Color Usage (Required)

- As a rule, use **Soft gray alone** for wordmarks (Japanese / English / single-line / two-line).
- As a rule, do not use Butter yellow as the wordmark text color (to avoid reduced readability and a cheap appearance).
- Let Butter yellow in the icon (Polka Piggy) provide most of the color's "cuteness," and create a unified impression through the lockup.

### 3.5 Color Codes (Finalized / Required)

- Soft gray (reference): `#626258` (a gray with a slight yellow cast)
- White (reference): `#F5F5F2`

#### Butter Yellow (Consistent Usage / Required)

Use **one consistent Butter yellow** (to avoid confusion from using similar colors together).

- Butter yellow (Base): `#F6E58D`

> Usage policy: As a rule, use only this Butter yellow in the UI, icons, and other assets.
> Where small areas become indistinct, compensate through **shape—shadows / borders / area / thickness**—without adding colors (see 3.3).

> Note: UI implementations may define graduated tonal tokens such as `textPrimary / textSecondary / borderSubtle`, based on Soft gray, to ensure readability and contrast (details are left to the implementation guide).

### 3.6 Wordmark Color in Dark Mode (Additional / Required)

- Reusing Soft gray alone is not mandatory on dark backgrounds.
- Adopt the policy of "same shape, color change only," and allow **White (#F5F5F2)** on dark backgrounds.
- The UI implementation determines the background threshold for switching and its actual application.

### 3.7 Recommended Butter Yellow Uses in the UI (Additional / Policy)

- Progress: Use `#F6E58D` for the fill.
- Badge: Use `#F6E58D` as the default background. If small areas become indistinct, use **shadows / borders / area** to support outlines and visibility.
- FAB: Use `#F6E58D` for the background and **shadows / shape / whitespace** to lift it from the background (do not add more color emphasis).
- Selected state: Use `#F6E58D` as the basis of a light background fill, and preferably indicate selection through shape (a left bar, underline, check mark, etc.). Do not communicate selection through background fill alone.

---

## 4. Icon Specification (Polka Piggy / White Background Version)

### 4.1 Concept (Finalized)

- Main subject: **A side-view silhouette of a piggy bank**
- Expression of "まぜまぜ" (mixing): **Butter yellow polka dots with a density gradient** on the body
- Combine white, shadow, and yellow to convey cleanliness, cuteness, and a slight association with money
- Do not evoke a financial service (a banking or investment app)

### 4.2 Base Composition (Required)

- Background: **White**
- Pig body: **White tones** (white to very light gray in the same family as the background)
- Outline: Define the boundary using **a Soft gray shadow (one drop-shadow layer)** rather than a drawn outline
- Pattern: **Butter yellow polka dots**
- Eye: **One black dot** (no highlights, whites of the eye, pupils, or similar detail)
- Tail: A **curly, coiled tail** is required (to strengthen the visual symbol of a pig)

### 4.3 Shape Rules (Legibility at Small Sizes)

- Simplify the silhouette to the level of a paper cutout
  - Show only two legs (not four thin legs)
  - Do not make the ears or tail too small (to prevent loss of detail)
- The coin slot on the back is a thick, short oval (its disappearance at small sizes is not fatal)

### 4.4 Shadow (Drop Shadow) Rules

- Use **only one shadow layer**
- Do not make it so dark that it resembles an outline (avoid a cheap appearance)
- Do not make it so faint that the shape disappears at 16–32px (ensure visibility)
- Adjustment priority: Shadow darkness > shadow distance > blur
- Treat the shadow as **an aid to recognizing the shape against white**, rather than a way to create three-dimensional volume

### 4.5 Polka Dot (Butter Yellow) Specification (Finalized / Important)

- The body pattern is **Butter yellow polka dots** (marbling is not adopted).
- Dots must be **flat, solid fills**, without gradients, shading, or highlights (to avoid a dirty appearance when reduced and prevent a cheap impression).
- The total number of dots is **10–15 (maximum 15)**. Do not overcrowd them.
- Use **mostly larger dots** (tiny granular dots are prohibited).
- Density gradient: **Sparse at the front (head), relatively dense at the rear (tail)**.
  - "Dense" does not mean completely filled (all-over fish-scale or tile-like patterns are prohibited).
- Limit the rear "dense area" to **the rear 30–40% of the body** (do not extend it across the entire body).
- **Partially cropped dots are allowed**.
  - Examples: A dot appearing only halfway or one-third visible at the body's outline
  - Purpose: Preserve recognizability at small sizes while keeping the pattern natural and cute
  - However, do not include so many cropped dots that the result looks messy (only a few)
- As a rule, dots must not touch each other (leave at least minimal spacing).
- Use **only `#F6E58D`** for Butter yellow in the icon (do not use other similar yellows).

### 4.6 Size Usage (Policy)

- Where possible, create the original at **512px or larger (recommended: 1024px)** and generate other sizes through automated downscaling
- Preserve the **side-view pig silhouette** at 16–32px (do not switch to a face-only version)
- Generally use a consistent design at 48–128px (downscaling the same master is acceptable)
- Do not introduce elements that break down at reduced sizes, such as thin lines, small text, or intricate patterns

### 4.7 Mask Tolerance (Android Maskable)

- Provide a safe margin around the perimeter (approximately 12–15%)
- Center important elements (pig body, eye, tail, and dot centers)
- The design must remain recognizable when cropped by rounded or circular masks

---

## 5. Logo / Wordmark

### 5.0 Purpose and Usage Assumptions (Required)

- A wordmark is an identifier that makes the app name **recognizable as a brand**, separate from UI body text.
- UI body text assumes **system fonts in both Japanese and English** (it must remain usable without loaded web fonts).
- Use wordmarks primarily as **images (SVG)** to minimize environmental differences.
- Maintain a neutral impression without leaning too heavily toward a specific platform, so future expansion to other ecosystems (beyond Microsoft) does not feel out of place.

Example system font stack

```css
/* UI body text (intended for both JP and EN) */
p {
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    "Noto Sans JP",
    "Hiragino Sans",
    "Yu Gothic UI",
    "Meiryo",
    "Helvetica Neue",
    Arial,
    sans-serif;
}
```

### 5.1 Japanese Wordmark (Recommended: Two Lines)

- First line: **まぜまぜ** (smaller)
- Second line: **貯金箱** (the main element, larger)

#### Recommended Rules

- Give "まぜまぜ" slightly wider letter spacing for elegance (without overdoing it)
- Normal letter spacing is acceptable for "貯金箱"
- Weight: まぜまぜ = Regular–Medium; 貯金箱 = Semibold

#### Additional Requirements (Required)

- Intended fonts for wordmark production: **Inter + IBM Plex Sans JP**
  - Prefer IBM Plex Sans JP for Japanese, and optionally prefer Inter for Latin letters and numerals (compositing in the design tool is acceptable).

- As a rule, use Soft gray alone (see 3.4 / 3.5).

- Do not add decorations (outlines / multiple shadow layers / gradients), so the wordmark remains legible at small sizes.

### 5.2 Japanese Subtitle

- **預金も投資も、まぜまぜ管理**
- Placement: Small, below the wordmark
- Color: Soft gray

#### Additional Requirements (Required)

- Do not turn the subtitle into a special logo treatment (an image or special font is not mandatory).
- Include it in an SVG / image as needed for fixed-layout uses such as store images.

### 5.3 English Wordmark (Two Lines + Subtitle)

- Top: **Mazemaze**
- Bottom: **Piggy Bank**
- Optional subtitle: **Mix & Allocate Savings**

#### Recommended Rules

- Do not set "Mazemaze" too tightly; slightly widen letter spacing when needed
- Give "Piggy Bank" a somewhat stronger weight as the main element (approximately Semibold)
- Keep the subtitle understated (Soft gray)

#### Additional Requirements (Required)

- As a rule, use **Mazemaze** in English (avoid CamelCase MazeMaze).
- Intended font for wordmark production: **Inter**
- As a rule, use Soft gray alone (see 3.4 / 3.5).

### 5.4 Text-Only Single-Line Version (Required)

Provide a text-only single-line version for narrow areas (such as headers) where the two-line wordmark does not fit.

- JP single line: **まぜまぜ貯金箱**
- EN single line: **Mazemaze Piggy Bank**
- Format: Normally SVG (single color)
- Color: Soft gray alone (see 3.4 / 3.5)

### 5.5 SVG Usage Requirements (Additional / Required)

- For distributed / implemented SVGs, **convert text to outlines without retaining text elements (`<text>`)**, and store it as **paths (`<path>`)** to eliminate font dependencies.
- SVGs must include `viewBox`; `width` / `height` are optional (allow scaling by the display surface).
- Wordmarks may use the same shape with color-only changes between light and dark modes.
- For accessibility, adding `role="img"` and `aria-label` (or `<title>`) is recommended for inline SVGs.

---

## 6. Lockups (Definition and Adopted Patterns)

### 6.1 What Is a Lockup?

- **A finished composition combining an icon (mark) and text (wordmark) in a fixed arrangement**.
- A template for consistent placement in headers, launch screens, store images, About, and other surfaces.

### 6.2 Adopted Lockups (Minimum Set)

1. **Horizontal lockup**
   - `[Icon]  [Wordmark]`
   - Small subtitle (JP or EN) at the bottom right (optional)

2. **Vertical lockup**
   - Top: Icon
   - Below: Wordmark (two lines)
   - Further below: Subtitle (optional)

### 6.3 Lockup Usage (Required)

- Create lockups as needed by **placing the icon and wordmark together**.

- Recommended formats:
  - Master: SVG (as a template)
  - Output: PNG as needed (store images, sharing images, etc.)

- Color roles within the lockup:
  - The icon provides "cuteness (Butter yellow)"
  - The wordmark provides a clean impression with Soft gray alone (3.4 / 3.5)

- On dark backgrounds, the wordmark may switch to White (#F5F5F2) (see 3.6).

---

## 7. Generative AI Production Instructions (Reference / Ready to Use)

### 7.1 Example Icon Generation Prompt (Positive)

- "White background. A simple side-view silhouette of a piggy bank. The pig body is white to very light gray. No drawn outline. Define the shape with a single Soft gray drop shadow. One black dot for the eye. A curly, coiled tail. A coin slot on the back (a short oval). Butter yellow (#F6E58D) polka dots on the body. The dots are flat solid fills, without gradients or shading. Mostly larger dots, 10–15 in total at most. Sparse near the head and relatively dense near the tail, without filling the area completely. A few dots may intersect the outline and appear half-visible. Flat and minimal, cute without looking cheap. A square app icon. Use only #F6E58D for yellow."

### 7.2 Elements to Avoid in Generation (Negative)

- Letters and numbers
- Thin lines, tiny granular dots, overcrowded patterns
- All-over fish-scale or tile-like patterns
- Strong highlights, strong reflections, metallic appearance, excessive 3D
- Transparent glass effects resembling glassmorphism / liquid glass (reduced readability and excessive decoration)
- Piles of gold coins, bundles of banknotes, bank buildings, cards, stock charts, etc. (being mistaken for a financial service)
- Background patterns or motifs (the background is solid white)

---

## 8. Quality Checks (Final Review to Avoid a Cheap Appearance)

- Yellow does not occupy too much area (it remains an accent)
- The shadow is not so dark that it resembles an outline (it does not look cheap)
- There are not too many dots (10–15, without filling the area completely)
- Dots have no gradients or shading (they are flat)
- There is no all-over scale-like or tile-like pattern
- The image is recognizable as a pig at 16–32px (the silhouette remains dominant)
- The eye is a dot (no added facial-expression detail)
- The tail is curly (the visual symbol clearly communicates a pig)
- No similar yellows other than Butter yellow (#F6E58D) are mixed in (it does not appear to use more colors)

---

## 9. Undecided / Future Considerations

- Dark-mode background and shadow treatment (same shape, color changes only)
- Store screenshot templates (background, whitespace, headings)
- Safe-area guidelines for maskable icons (specific pixels / proportions)
- Spacing and proportion guidelines for horizontal / vertical SVG lockup templates (numerical values)
- Finalization of UI tokens (textPrimary / textSecondary / borderSubtle, etc.)
- Component-specific implementation guidance based on Butter yellow (#F6E58D) (Progress / Badge / FAB / Selected)
