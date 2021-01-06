module.exports = function (RED) {
  "use strict";

  function YoutubeDownload(n) {
    RED.nodes.createNode(this, n);
    this.url = n.url;
    this.urlType = n.urlType;
    this.path = n.path;
    this.pathType = n.pathType;
    const ytdl = require("ytdl-core");
    const Fs = require("fs");
    const path = require("path");
    const ytpl = require("ytpl");
    const NodeID3 = require("node-id3");

    this.status({});
    var node = this;

    const handleError = function (url_, e, path_) {
      var errorText = e + ": cannot download " + url_;
      if (path_) {
        errorText = errorText + " on " + path_;
      }
      node.log(errorText);
      node.status({ fill: "red", shape: "ring", text: errorText });
    };

    const cleanupTitle = function (title) {
      title = title.replace(/\//g, "-");
      title = title.replace(/\\/g, "-");
      title = title.replace(/&/g, "and");
      title = title.replace(/ HQ/g, "");
      // Uncomment to replace spaces with underscores
      // title = title.replace(/ /g, "_");
      return title;
    };

    const writeId3Tag = function (file, title, artist, album, trackNumber) {
      //  Define the tags for your file using the ID (e.g. APIC) or the alias (see at bottom)
      let tags = {
        title: title,
        artist: artist,
        album: album || "Youtube",
        TRCK: trackNumber || 1,
      };

      let success = NodeID3.write(tags, file);
      if (!success) {
        throw "NO Tag written " + JSON.stringify(tags);
      }

      let tagsOut = NodeID3.read(file);
      console.log(tagsOut);
    };

    const download = function (index, urlList, path_, msg) {
      var size = urlList.length;
      if (index >= size) {
        node.status({ fill: "green", shape: "ring", text: "Completed" });
        return;
      }
      var url_ = urlList[index];

      const prefix = ( index + 1 ) + "/" + size;

      node.status({ fill: "blue", shape: "ring", text: prefix + " starting" });

      //default video
      var options = {
        filter: function (format) {
          return format.container === "mp4";
        },
      };
      var ext = "mp4";
      //audio only
      if (msg.audioonly) {
        options = { filter: "audioonly" }; // quality: 'highestaudio',filter: 'audioonly'
        ext = "mp3";
      }

      //get info
      ytdl
        .getInfo(url_)
        .then((info) => {
          //video title as file name
          msg.title = cleanupTitle(info.videoDetails.title);
          msg.file = path_ + msg.title + "." + ext;

          var output = msg.file;

          node.log("Downloading " + url_ + " on " + output);

          const video = ytdl.downloadFromInfo(info, options);
          let starttime;
          video.pipe(Fs.createWriteStream(output));
          video.once("response", () => {
            starttime = Date.now();
          });
          video.on("progress", (chunkLength, downloaded, total) => {
            const floatDownloaded = downloaded / total;
            const downloadedMinutes = (Date.now() - starttime) / 1000 / 60;

            var diagn =
              prefix +
              " " +
              `(${(downloaded / 1024 / 1024).toFixed(2)}MB of ${(
                total /
                1024 /
                1024
              ).toFixed(2)}MB)\n`;

            node.status({ fill: "yellow", shape: "ring", text: diagn });
          });
          video.on("end", () => {
            node.log("\n\n");
            node.status({ fill: "blue", shape: "dot", text: prefix + " Done" });

            const idTitle = info.videoDetails.media.song
              ? info.videoDetails.media.song
              : msg.title;
            const idArtist = info.videoDetails.media.artist
              ? info.videoDetails.media.artist
              : msg.title;
            const idAlbum = info.videoDetails.media.album
              ? info.videoDetails.media.album
              : msg.playlistTitle;

            try {
              //id3 tag
              writeId3Tag(output, idTitle, idArtist, idAlbum, index);
            } catch (e) {
              console.log("Error writing tags to " + output, e);
            }
            //send you a single message for url
            let newMsg = Object.assign({}, msg);
            newMsg.payload = url_;
            node.send(newMsg);

            //next
            var next = index + 1;
            download(next, urlList, path_, msg);
          });

          node.ytdl = video;
        })
        .catch((err) => {
          handleError(url_, err);
          return;
        });
    };

    const isPlaylist = function (url_) {
      if (url_.indexOf("list=") > -1) {
        return true;
      }
      return false;
    };

    const downloadPlaylist = function (playlistId, path_, msg) {
      ytpl(playlistId)
        .then((playlist) => {
          node.log(playlist);
          node.log(
            "Downloading playlist " +
              playlist.title +
              " " +
              playlist.items.length +
              " videos"
          );
          //node.log(JSON.stringify(playlist));

          //playlist folder
          var title = cleanupTitle(playlist.title);
          var playlistPath = path_ + title + "/";
          if (!Fs.existsSync(playlistPath)) {
            Fs.mkdirSync(playlistPath);
          }
          msg.playlistTitle = title;
          //extracting video's id
          var urlList = [];
          for (var i = 0; i < playlist.items.length; i++) {
            var item = playlist.items[i];
            urlList.push(item.id);
          }
          download(0, urlList, playlistPath, msg);
        })
        .catch((err) => {
          throw err;
        });
    };

    this.on("input", function (msg) {
      try {
        node.status({ fill: "blue", shape: "ring", text: "Starting" });
        var path_ = msg.path;
        if (!path_) {
          path_ = RED.util.evaluateNodeProperty(
            node.path,
            node.pathType,
            node,
            msg
          );
        }
        var url_ = msg.payload;
        if (!url_) {
          url_ = RED.util.evaluateNodeProperty(
            node.url,
            node.urlType,
            node,
            msg
          );
        }

        if (!Fs.existsSync(path_)) {
          throw "Invalid path";
        }
        if (!url_) {
          throw "No url provided";
        }

        if (!path_.endsWith("/")) {
          path_ += "/";
        }

        if (isPlaylist(url_)) {
          downloadPlaylist(url_, path_, msg);
        } else {
          var urlList;
          if (Array.isArray(url_)) {
            urlList = url_;
            node.log("Downloading array of files+ on " + path_);
          } else {
            urlList = [url_];
            node.log("Downloading " + url_ + " on " + path_);
          }

          //recursive download
          download(0, urlList, path_, msg);
        }
      } catch (e) {
        handleError(url_, e, path_);
      }
    });

    this.on("close", function () {
      if (node.ytdl && node.ytdl.destroy) {
        node.ytdl.destroy();
      }
      node.status({ fill: "green", shape: "dot", text: "Done" });
    });
  }
  RED.nodes.registerType("youtube-ytdl", YoutubeDownload);
};
