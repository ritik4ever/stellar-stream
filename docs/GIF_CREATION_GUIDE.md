# GIF Creation Guide for README

This guide explains how to create and host the video walkthrough GIFs for the StellarStream README.

## Overview

Three GIFs are needed to demonstrate key workflows:
1. **Create Stream** - Creating a new payment stream
2. **Monitor Vesting** - Viewing recipient dashboard with vesting progress
3. **Claim Tokens** - Claiming vested tokens from active streams

## Requirements

- Each GIF must be **under 5MB** in size
- GIFs should match the current UI (use the actual running application)
- Include descriptive alt text for accessibility
- Host as GitHub release assets

## Recording Tools

### Recommended Tools

1. **OBS Studio** (Free, cross-platform)
   - Download: https://obsproject.com/
   - Record screen, then export as GIF using plugin or converter

2. **Loom** (Free tier available)
   - Download: https://www.loom.com/
   - Record and export as GIF directly

3. **ScreenToGif** (Windows, Free)
   - Download: https://www.screentogif.com/
   - Lightweight, specifically for GIF creation

4. **Kap** (macOS, Free)
   - Download: https://getkap.co/
   - Simple screen recording with GIF export

## Recording Guidelines

### 1. Create Stream GIF

**Steps to record:**
1. Start the application locally (`npm run dev:frontend` and `npm run dev:backend`)
2. Navigate to http://localhost:3000
3. Click "Create Stream" or navigate to the sender dashboard
4. Fill in the form fields:
   - Sender Account: Use a test Stellar address (e.g., `GABCD...`)
   - Recipient Account: Use a different test Stellar address
   - Asset Code: Select "USDC"
   - Total Amount: Enter "150"
   - Duration (minutes): Enter "1440"
   - Start In (minutes): Enter "0"
5. Click "Create Stream" button
6. Show the fee preview modal
7. Click "Confirm" to complete the stream creation
8. Stop recording

**Tips:**
- Keep the recording under 30 seconds
- Use smooth, deliberate mouse movements
- Ensure all text is readable
- Show the success state after creation

### 2. Monitor Vesting GIF

**Steps to record:**
1. Start the application locally
2. Navigate to the Recipient Dashboard (/recipient)
3. Connect a wallet (or use a test address)
4. Show the dashboard with active streams
5. Highlight the vesting progress bars
6. Show the claimable amounts updating
7. Display the metrics cards (Active streams, Claimable, etc.)
8. Stop recording

**Tips:**
- Ensure there are active streams visible (create test streams first)
- Show the real-time progress indicators
- Highlight the percentage complete and progress bars
- Keep recording under 20 seconds

### 3. Claim Tokens GIF

**Steps to record:**
1. Start the application locally
2. Navigate to the Recipient Dashboard
3. Connect wallet
4. Show an active stream with claimable tokens
5. Click the "Claim" button
6. Show the claiming state with spinner
7. Display the success toast notification
8. Show the updated stream with claimed amount
9. Stop recording

**Tips:**
- Ensure the stream has vested tokens available
- Show the wallet connection if needed
- Highlight the success confirmation
- Keep recording under 25 seconds

## GIF Optimization

To ensure GIFs stay under 5MB:

### Using EZGIF (Online Tool)
1. Upload your recorded video/GIF to https://ezgif.com/video-to-gif
2. Adjust settings:
   - Frame rate: 10-15 fps (lower = smaller file)
   - Scale: Reduce to 800-1000px width
   - Quality: Medium
3. Preview and download if under 5MB
4. If still too large, reduce frame rate or dimensions further

### Using FFmpeg (Command Line)
```bash
# Convert video to optimized GIF
ffmpeg -i input.mp4 -vf "fps=10,scale=800:-1:flags=lanczos" -c:v gif output.gif

# Optimize further with gifsicle
gifsicle --optimize=3 --colors=256 output.gif -o optimized.gif
```

## Hosting on GitHub

### Step 1: Create a GitHub Release

1. Go to your repository on GitHub
2. Click "Releases" in the right sidebar
3. Click "Create a new release"
4. Tag version: `v1.0.0` (or appropriate version)
5. Release title: "StellarStream v1.0.0"
6. Add release notes if desired

### Step 2: Upload GIFs as Release Assets

1. In the release creation page, scroll to "Binary release assets"
2. Drag and drop each GIF file:
   - `create-stream.gif`
   - `monitor-vesting.gif`
   - `claim-tokens.gif`
3. Wait for uploads to complete
4. Publish the release

### Step 3: Update README URLs

Replace the placeholder URLs in README.md with your actual repository URLs:

```markdown
### Create Stream
![Create stream walkthrough](https://github.com/YOUR_USERNAME/stellar-stream/releases/download/v1.0.0/create-stream.gif)
*Alt text: Animated GIF showing how to create a new payment stream...*

### Monitor Vesting
![Monitor vesting walkthrough](https://github.com/YOUR_USERNAME/stellar-stream/releases/download/v1.0.0/monitor-vesting.gif)
*Alt text: Animated GIF showing the recipient dashboard...*

### Claim Tokens
![Claim tokens walkthrough](https://github.com/YOUR_USERNAME/stellar-stream/releases/download/v1.0.0/claim-tokens.gif)
*Alt text: Animated GIF demonstrating how to claim vested tokens...*
```

Replace `YOUR_USERNAME` with your actual GitHub username.

## Accessibility

Each GIF includes alt text that:
- Describes what the GIF shows
- Explains the purpose of the workflow
- Is concise but informative
- Helps users who cannot see the GIF understand the content

## Verification Checklist

Before considering the task complete:

- [ ] All three GIFs recorded successfully
- [ ] Each GIF is under 5MB in size
- [ ] GIFs match the current UI styling
- [ ] Alt text is descriptive and accurate
- [ ] GIFs uploaded to GitHub release
- [ ] README.md URLs updated with correct repository links
- [ ] GIFs render correctly in the README
- [ ] Alt text displays properly on GitHub

## Troubleshooting

**GIF too large:**
- Reduce frame rate to 8-10 fps
- Reduce dimensions to 600-800px width
- Reduce color palette to 128 or 64 colors

**GIF quality poor:**
- Increase frame rate to 15-20 fps
- Increase dimensions to 1000-1200px width
- Use lanczos scaling for better quality

**GIF not rendering in README:**
- Verify the GitHub release URL is correct
- Ensure the GIF file name matches exactly
- Check that the release is published (not draft)
- Clear browser cache and reload

## Alternative Hosting Options

If GitHub releases don't work for your use case:

- **Imgur**: Upload and use direct image links
- **GIPHY**: Upload and use embed links
- **Cloudinary**: Upload and use CDN links
- **AWS S3**: Upload and use public bucket URLs

Note: GitHub releases are recommended for this project as they keep assets with the repository versioning.
