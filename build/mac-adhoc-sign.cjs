// electron-builder afterPack hook: ad-hoc sign the macOS bundle.
//
// With `identity: null` electron-builder skips signing entirely, which leaves only the
// linker's stub signature on the main binary ("code has no resources but signature
// indicates they must be present"). Gatekeeper treats that quarantined state as a BROKEN
// signature and shows "LivestreamSync is damaged and can't be opened" with no override.
// A proper ad-hoc signature (`codesign --sign -`, no Apple account needed) makes the
// bundle verify cleanly, so users get the documented "unverified developer" flow
// (System Settings → Privacy & Security → Open Anyway) instead of a dead end.
// CommonJS on purpose: electron-builder loads hooks via require().
const { execFileSync } = require('node:child_process')
const path = require('node:path')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log(`  • ad-hoc signing ${appPath}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  // Fail the build if the result doesn't verify — never ship a broken-signature app again.
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
  console.log('  • ad-hoc signature verified')
}
