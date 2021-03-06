/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        ZettlrConfig class
 * CVM-Role:        Model
 * Maintainer:      Hendrik Erz
 * License:         GNU GPL v3
 *
 * Description:     This class fulfills two basic tasks: (1) Manage the app's
 *                  configuration, stored in the config.json inside the user
 *                  data directory. (2) Check the environment whether or not
 *                  specific conditions exist (such as the pandoc or xelatex
 *                  binaries)
 *
 * END HEADER
 */

const fs             = require('fs');
const path           = require('path');
const {app}          = require('electron');
const commandExists  = require('command-exists').sync; // Does a given shell command exist?
const {isFile,isDir} = require('../common/zettlr-helpers.js');

/**
 * This class represents the configuration of Zettlr, represented by the
 * config.json file in the user's data directory as well as some environment
 * variables. Basically, this class tells Zettlr what the user wants and what
 * the environment Zettlr is running in is capable of.
 */
class ZettlrConfig
{
    /**
     * Preset sane defaults, then load the config and perform a system check.
     * @param {Zettlr} parent Parent Zettlr object.
     */
    constructor(parent)
    {
        this.parent = parent;
        this.configPath = app.getPath('userData');
        this.configFile = path.join(this.configPath, 'config.json');
        this.config = null;

        // Environment variables
        this.env = {
            'pandoc': false,
            'xelatex': false
        };

        // Additional environmental paths (for locating LaTeX and Pandoc)
        if(process.platform === 'win32') {
            this._additional_paths = require('../common/data.json').additional_paths.win32;
        } else if(process.platform === 'linux') {
            this._additional_paths = require('../common/data.json').additional_paths.linux;
        } else if(process.platform === 'darwin') {
            this._additional_paths = require('../common/data.json').additional_paths.macos;
        } else {
            this._additional_paths = []; // Fallback: No additional paths
        }

        // Supported Spellcheck languages
        this.supportedLangs = [
            'de_DE',
            'fr_FR',
            'en_US',
            'en_GB'
        ];

        // Config Template providing all necessary arguments
        this.cfgtpl = {
            // Root directories
            "openPaths" : [],
            // Visible attachment filetypes
            "attachmentExtensions": [
                ".pdf",     // PDF
                ".odt",     // OpenDocument Types
                ".odp",
                ".ods",
                ".doc",     // Microsoft Office Types
                ".docx",
                ".xls",
                ".xlsx",
                ".ppt",
                ".pptx",
                ".do",      // Stata do-files
                ".r",       // R script file
                ".py",      // Python script file
                ".sav",     // SPSS script files
                ".zsav",
                ".csv",     // CSV data file
                ".png",     // Images
                ".jpg",
                ".jpeg",
                ".gif",
                ".tiff"
            ],
            // UI related options
            "darkTheme" : false,
            "snippets"  : true,
            "muteLines" : true,  // Should the editor mute lines in distraction free mode?
            "combinerState" : 'collapsed', // collapsed = Preview or directories visible --- expanded = both visible
            // Export options
            "pandoc"    : 'pandoc',
            "xelatex"   : 'xelatex',
            "export"    : {
                "dir": 'temp',   // Can either be "temp" or "cwd" (current working directory)
                "stripIDs": true,  // Strip ZKN IDs such as @ID:<id>
                "stripTags": false, // Strip tags a.k.a. #tag
                "stripLinks": "full", // Strip internal links: "full" - remove completely, "unlink" - only remove brackets, "no" - don't alter
            },
            // PDF options (for all documents; projects will copy this object over)
            "pdf"       : {
                "author" : 'Generated by Zettlr', // Default user name
                "keywords" : '', // PDF keywords
                "papertype" : 'a4paper', // Paper to use, e.g. A4 or Letter
                "pagenumbering": 'gobble', // By default omit page numbers
                "tmargin": 3, // Margins to paper (top, right, bottom, left)
                "rmargin": 3,
                "bmargin": 3,
                "lmargin": 3,
                "margin_unit": 'cm',
                "lineheight": '1.5', // Default: 150% line height
                "mainfont": 'Times New Roman', // Main font
                "fontsize": 12 // Will be translated to pt
            },
            // Language
            "spellcheck": {
                'en_US' : (this.getLocale() === 'en_US') ? true : false,
                'en_GB' : (this.getLocale() === 'en_GB') ? true : false,
                'de_DE' : (this.getLocale() === 'de_DE') ? true : false,
                'fr_FR' : (this.getLocale() === 'fr_FR') ? true : false
            },
            "app_lang": this.getLocale(),
            "debug": false
        };

        // Load the configuration
        this.load();

        // Run system check
        this.checkSystem();

        // Remove potential dead links to non-existent files and dirs
        this.checkPaths();

        // Put the attachment extensions into the global so that the helper
        // function isAttachment() can grab them
        global.attachmentExtensions = this.config.attachmentExtensions;
    }

    /**
     * This function only (re-)reads the configuration file if present
     * @return {ZettlrConfig} This for chainability.
     */
    load()
    {
        this.config = this.cfgtpl;
        let readConfig = {};

        // Check if dir exists. If not, create.
        try {
            let stats = fs.lstatSync(this.configPath);
        } catch(e) {
            fs.mkdirSync(this.configPath);
        }

        // Does the file already exist?
        try {
            let stats = fs.lstatSync(this.configFile);
            readConfig = JSON.parse(fs.readFileSync(this.configFile, { encoding: 'utf8' }));
        } catch(e) {
            fs.writeFileSync(this.configFile, JSON.stringify(this.cfgtpl), { encoding: 'utf8' });
            return this; // No need to iterate over objects anymore
        }

        this.update(readConfig);

        return this;
    }

    /**
     * Write the config file (e.g. on app exit)
     * @return {ZettlrConfig} This for chainability.
     */
    save()
    {
        if(this.configFile == null || this.config == null) {
            this.load();
        }
        // (Over-)write the configuration
        fs.writeFileSync(this.configFile, JSON.stringify(this.config), { encoding: 'utf8' });

        return this;
    }

    /**
     * This function runs a general environment check and tries to determine
     * some environment variables (such as the existence of pandoc or xelatex)
     * @return {ZettlrConfig} This for chainability.
     */
    checkSystem()
    {
        let delim = (process.platform === 'win32') ? ';' : ':' ;

        if(this._additional_paths.length > 0) {
            // First integrate the additional paths that we need.
            let nPATH = process.env.PATH.split(delim);

            for(let x of this._additional_paths) {
                // Check for both trailing and non-trailing slashes (to not add any
                // directory more than once)
                let y = (x[x.length-1] === '/') ? x.substr(0, x.length-1) : x + '/';
                if(!nPATH.includes(x) && !nPATH.includes(y)) {
                    nPATH.push(x);
                }
            }

            process.env.PATH = nPATH.join(delim);
        }

        // Also add to PATH xelatex and pandoc-directories if these variables
        // contain actual dirs.
        if(path.dirname(this.get('xelatex')).length > 0) {
            if(process.env.PATH.indexOf(path.dirname(this.get('xelatex'))) == -1) {
                process.env.PATH += delim + path.dirname(this.get('xelatex'));
            }
        }

        if(path.dirname(this.get('pandoc')).length > 0) {
            if(process.env.PATH.indexOf(path.dirname(this.get('pandoc'))) == -1) {
                process.env.PATH += delim + path.dirname(this.get('pandoc'));
            }
        }

        // Now check the availability of the pandoc and xelatex commands.
        if(commandExists('pandoc')) {
            this.env.pandoc = true;
        }

        // Check xelatex availability (PDF exports)
        if(commandExists('xelatex')) {
            this.env.xelatex = true;
        }

        // This function returns the platform specific template dir for pandoc
        // template files. This is based on the electron-builder options
        // See https://www.electron.build/configuration/contents#extraresources
        // Quote: "Contents/Resources for MacOS, resources for Linux and Windows"
        let dir = path.dirname(app.getPath('exe')); // Get application directory

        if(process.platform === 'darwin') {
            // The executable lies in Contents/MacOS --> navigate up a second time
            // macos is capitalized "Resources", not "resources" in lowercase
            dir = path.join(path.dirname(dir), 'Resources');
        } else {
            dir = path.join(dir, 'resources');
        }

        this.env.templateDir = path.join(dir, 'pandoc');

        return this;
    }

    /**
     * Checks the validity of each path that should be opened and removes all
     * those that are invalid
     * @return {void} Nothing to return.
     */
    checkPaths()
    {
        for(let i = 0; i < this.config['openPaths'].length; i++) {
            try {
                let s = fs.lstatSync(this.config['openPaths'][i]);
            } catch(e) {
                // Remove the path
                this.config['openPaths'].splice(i, 1);
                --i;
            }
        }

        // Remove duplicates
        this.config['openPaths'] = [...new Set(this.config['openPaths'])];

        // Now sort the paths.
        this._sortPaths();
    }

    /**
     * Adds a path to be opened on startup
     * @param {String} p The path to be added
     * @return {Boolean} True, if the path was succesfully added, else false.
     */
    addPath(p)
    {
        // Only add valid and unique paths
        if((isFile(p) || isDir(p)) && !this.config['openPaths'].includes(p)) {
            this.config['openPaths'].push(p);
            this._sortPaths();
            return true;
        }

        return false;
    }

    /**
     * Removes a path from the startup paths
     * @param  {String} p The path to be removed
     */
    removePath(p)
    {
        if(this.config['openPaths'].includes(p)) {
            this.config['openPaths'].splice(this.config['openPaths'].indexOf(p), 1);
        }
    }

    /**
     * Returns a config property
     * @param  {String} attr The property to return
     * @return {Mixed}      Either the config property or null
     */
    get(attr)
    {
        if(!attr) {
            // If no attribute is given, simply return the complete config object.
            return this.getConfig();
        }

        if(attr.indexOf('.') > 0) {
            // A nested argument was requested, so iterate until we find it
            let nested = attr.split('.');
            let cfg = this.config;
            for(let arg of nested) {
                if(cfg.hasOwnProperty(arg)) {
                    cfg = cfg[arg];
                } else {
                    return null; // The config option must match exactly
                }
            }

            return cfg; // Now not the requested config option.
        }

        // Plain attribute requested
        if(this.config.hasOwnProperty(attr)){
            return this.config[attr];
        } else {
            return null;
        }
    }

    /**
     * Simply returns the complete config object.
     * @return {Object} The configuration object.
     */
    getConfig()
    {
        return this.config;
    }

    /**
     * Returns an environment variable
     * @param  {String} attr The environment variable to be returned.
     * @return {Mixed}      Either the variable's value or null.
     */
    getEnv(attr)
    {
        if(this.env.hasOwnProperty(attr)) {
            return this.env[attr];
        } else {
            return null;
        }
    }

    /**
     * Returns the language (but always specified in the form <main>_<sub>,
     * b/c we rely on it). If no "sub language" is given (e.g. only en, fr or de),
     * then we assume the primary language (e.g. this function returns en_US for en,
     * fr_FR for fr and de_DE for de. And yes, I know that British people won't
     * like me for that. I'm sorry.)
     * @return {String} The user's locale
     */
    getLocale()
    {
        let lang = app.getLocale();
        let mainlang = null;

        if(lang.indexOf('-') > -1) {
            // Specific sub-lang
            mainlang = lang.split('-')[0];
            lang = lang.split('-')[1];
        } else {
            // Only mainlang
            mainlang = lang;
            lang = null;
        }

        for(let sup of this.supportedLangs) {
            let ml = sup.split('_')[0];
            let sl = sup.split('_')[1];
            if(ml === mainlang) {
                if(lang === null) {
                    return sup;
                } else {
                    if(sl === lang) {
                        return sup;
                    }
                }
            }
        }

        return 'en_US'; // Fallback default
    }

    /**
     * Return all supported languages.
     * @return {Array} An array containing all allowed language codes.
     */
    getSupportedLangs()
    {
        return this.supportedLangs;
    }

    /**
     * Sets a configuration option
     * @param {String} option The option to be set
     * @param {Mixed} value  The value of the config variable.
     * @return {Boolean} Whether or not the option was successfully set.
     */
    set(option, value)
    {
        // Don't add non-existent options
        if(this.config.hasOwnProperty(option)) {
            this.config[option] = value;
            return true;
        }

        return false;
    }

    /**
     * Update the complete configuration object with new values
     * @param  {Object} newcfg               The new object containing new props
     * @param  {Object} [oldcfg=this.config] Necessary for recursion
     * @return {void}                      Does not return anything.
     */
    update(newcfg, oldcfg = this.config)
    {
        // Overwrite all given attributes (and leave the not given in place)
        // This will ensure sane defaults.
        for (var prop in oldcfg) {
            if (newcfg.hasOwnProperty(prop) && (newcfg[prop] != null)) {
                // We have some variable-length arrays that only contain
                // strings, e.g. we cannot update them using update()
                if((typeof oldcfg[prop] === 'object') && !Array.isArray(oldcfg[prop])) {
                    // Update sub-object
                    this.update(newcfg[prop], oldcfg[prop]);
                } else {
                    oldcfg[prop] = newcfg[prop];
                }
            }
        }

        return;
    }

    /**
     * Sorts the paths prior to using them alphabetically and by type.
     * @return {ZettlrConfig} Chainability.
     */
    _sortPaths()
    {
        let f = [];
        let d = [];
        for(let p of this.config['openPaths']) {
            if(isDir(p)) {
                d.push(p);
            } else {
                f.push(p);
            }
        }
        f.sort();
        d.sort();
        this.config['openPaths'] = f.concat(d);

        return this;
    }
}

module.exports = ZettlrConfig;
