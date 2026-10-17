import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class Kernel {
    constructor() {
        this.features = new Map();
        this.app = null;
        this.server = null; // Storing the http server
        this.loaded = false;
    }

    async boot(app, server, featuresDir = './features') {
        console.log('🚀 [Kernel] Booting...');
        this.app = app;
        this.server = server;

        const absFeaturesDir = path.resolve(__dirname, featuresDir);

        if (!fs.existsSync(absFeaturesDir)) {
            console.error(`❌ [Kernel] Features directory not found: ${absFeaturesDir}`);
            return;
        }

        this.discoverFeatures(absFeaturesDir);
        console.log(`🔍 [Kernel] Discovered ${this.features.size} feature(s).`);

        for (const [id] of this.features) {
            await this.mountFeature(id);
        }

        this.loaded = true;
        console.log(`✅ [Kernel] Ready. ${this.features.size} feature(s) active.\n`);
    }

    discoverFeatures(currentPath) {
        if (!fs.existsSync(currentPath)) return;

        const manifestPath = path.join(currentPath, 'feature.manifest.json');

        if (fs.existsSync(manifestPath)) {
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

                if (!manifest.id || !manifest.basePath) {
                    console.warn(`⚠️  [Kernel] Skipping manifest at ${currentPath}: missing id or basePath`);
                    return;
                }

                if (manifest.enabled === false) {
                    console.log(`⏭️  [Kernel] Skipping disabled feature: ${manifest.id}`);
                    return;
                }

                this.features.set(manifest.id, {
                    ...manifest,
                    dirPath: currentPath,
                    loaded: false
                });
            } catch (e) {
                console.error(`❌ [Kernel] Could not parse manifest at ${currentPath}: ${e.message}`);
            }
            return; 
        }

        const IGNORE = ['node_modules', '.git', '_example', '_template', 'temp', '.DS_Store'];
        let entries;

        try {
            entries = fs.readdirSync(currentPath, { withFileTypes: true });
        } catch (e) {
            console.error(`❌ [Kernel] Cannot read directory ${currentPath}: ${e.message}`);
            return;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (IGNORE.includes(entry.name)) continue;
            this.discoverFeatures(path.join(currentPath, entry.name));
        }
    }

    async mountFeature(featureId) {
        const feature = this.features.get(featureId);

        try {
            if (feature.routes) {
                const routePath = path.join(feature.dirPath, feature.routes);
                if (fs.existsSync(routePath)) {
                    // Convert Windows backslashes to forward slashes for dynamic import
                    const fileUrl = 'file://' + routePath.replace(/\\/g, '/');
                    const routerModule = await import(fileUrl);
                    this.app.use(feature.basePath, routerModule.default || routerModule.router);
                    console.log(`  🔌 ${feature.name} → ${feature.basePath}`);
                }
            }

            if (feature.boot) {
                const bootPath = path.join(feature.dirPath, feature.boot);
                if (fs.existsSync(bootPath)) {
                    const fileUrl = 'file://' + bootPath.replace(/\\/g, '/');
                    const bootModule = await import(fileUrl);
                    const bootFn = bootModule.default || bootModule.boot || bootModule.init;
                    if (typeof bootFn === 'function') await bootFn(this.app, this.server, this);
                }
            }

            feature.loaded = true;

        } catch (error) {
            console.error(`  ❌ Failed to mount ${featureId}: ${error.message}`);
            console.error(error);
        }
    }

    getAllFeatures() {
        return Array.from(this.features.values());
    }
}

export const kernel = new Kernel();
