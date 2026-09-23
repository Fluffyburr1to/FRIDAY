# icons — placeholders

**Every file here is a solid dark square, generated in a build step.**

They exist because macOS bundling requires an icon, not because anyone designed one. Real branding
is a product decision and does not belong in a scaffolding commit.

Replacing them is `pnpm --filter @friday/desktop tauri icon <source.png>`, which regenerates the
whole set from one square source image.

The Android and iOS sets that command also produces were deleted: mobile is Chapter 08's milestone,
and unused generated files are noise.
