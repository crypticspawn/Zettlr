/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        ZettlrProject class
 * CVM-Role:        Model
 * Maintainer:      Hendrik Erz
 * License:         GNU GPL v3
 *
 * Description:     This file contains a class that provides functions for a
 *                  functional project deployment in Zettlr. It extends the
 *                  functionality of ZettlrDir to also be able to export all
 *                  files in one single PDF file. Therefore here's the
 *                  functionality that you need to write whole books!
 *
 * END HEADER
 */

const fs                        = require('fs');
const path                      = require('path');
const ZettlrExport              = require('./zettlr-export.js');
const sanitize                  = require('sanitize-filename');
const { flattenDirectoryTree }  = require('../common/zettlr-helpers.js');

const PROJECT_FILE = '.ztr-project';

class ZettlrProject
{
    constructor(directory)
    {
        this._dir = directory;
        this._cfgtpl = {
            // This object contains all necessary config values. This classes'
            // functionality has been taken from ZettlrConfig a lot.
            "pdf" : {
                "author" : 'Generated by Zettlr', // Default user name
                "keywords" : '', // PDF keywords
                "papertype" : 'a4paper', // Paper to use, e.g. A4 or Letter
                "pagenumbering": 'arabic',
                "tmargin": 3, // Margins to paper (top, right, bottom, left)
                "rmargin": 3,
                "bmargin": 3,
                "lmargin": 3,
                "margin_unit": 'cm',
                "lineheight": '1.2',
                "mainfont": 'Times New Roman',
                "fontsize": 12,
                "toc": true,   // Default: generate table of contents
                "tocDepth": 2, // Default: evaluate until level 2
                "titlepage": true // Generate a title page by default
            },
            "title": this._dir.name // Default project title is the directory's name
        };
        this._cfg = null;
        this._projectFile = path.join(this._dir.path, PROJECT_FILE);

        this._read();
    }

    _read()
    {
        this._cfg = this._cfgtpl;
        try {
            let stat = fs.lstatSync(this._projectFile);
            this.update(fs.readFileSync(this._projectFile, 'utf8'));
        } catch(e) {
            this.save(); // Simply create the file
        }
    }

    save()
    {
        fs.writeFileSync(this._projectFile, JSON.stringify(this._cfg), 'utf8');
    }

    /**
     * This function builds the complete project at once.
     */
    build()
    {
        // Receive a two dimensional array of all directory contents
        let files = flattenDirectoryTree(this._dir);

        // Reduce to files-only
        for(let i = 0; i < files.length; i++) {
            if(files[i].type != 'file') {
                files.splice(i, 1);
                i--;
            }
        }

        // Concat the files
        let contents = [];
        for(let file of files) {
            contents.push(file.read());
        }

        // Make one string
        contents = contents.join('\n');

        // Mock a file object to which ZettlrExport has access
        let tempfile = {
            'path': path.join(this._dir.path, sanitize(this._cfg.title)),
            'name': sanitize(this._cfg.title), // obvious filename
            'read': () => { return contents; }
        };

        // Start up the Exporter
        let opt = {
            'format': 'pdf',      // Which format: "html", "docx", "odt", "pdf"
            'file': tempfile,           // The file to be exported
            'dest': this._dir.path, // On project exports, always dir path
            'stripIDs': true,
            'stripTags': true,
            'stripLinks': 'full',
            'pdf': this._cfg.pdf,
            'title': this._cfg.title,
            'author': this._cfg.pdf.author,
            'keywords': this._cfg.pdf.keywords
        };

        try {
            new ZettlrExport(opt); // TODO don't do this with instantiation
        } catch(err) {
            throw err;
            // console.log(err.name + ': ' + err.message);
            // this.notify(err.name + ': ' + err.message); // Error may be thrown
        }
    }

    /**
     * Removes the project file
     * @return {null} Always returns null.
     */
    remove()
    {
        // This removes the project file.
        try {
            let stat = fs.lstatSync(this._projectFile);
            fs.unlink(this._projectFile, (err) => {
                if(err) {
                    // TODO: Handle error.
                }
            });
        } catch(e) {
            // No file present, so let's simply do nothing.
        }

        return null;
    }

    /**
     * Returns the Project properties
     * @return {Object} The properties for this project.
     */
    getProperties()
    {
        return this._cfg;
    }

    /**
     * Update the complete configuration object with new values
     * @param  {Object} newcfg               The new object containing new props
     * @param  {Object} [oldcfg=this.config] Necessary for recursion
     * @return {void}                      Does not return anything.
     */
    update(newcfg, oldcfg = this._cfg)
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
    }

    /**
     * Static method used by ZettlrDir to determine whether or not it's a project.
     * @param  {ZettlrDir}  directory The directory for which existence of this file should be testet.
     * @return {Boolean}           Returns true, if a corresponding file has been found, or null.
     */
    static isProject(directory)
    {
        try {
            let stat = fs.lstatSync(path.join(directory.path, PROJECT_FILE));
            return true; // A project file has been found, so return true
        } catch(e) {
            return false; // No project file present -> return false.
        }
    }
}

module.exports = ZettlrProject;
