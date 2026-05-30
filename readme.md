## Usage

- Get an API key from [OMDb API](https://www.omdbapi.com/apikey.aspx) so that you can fetch movie info
- Populate the `movies.txt` file with movie titles
- Run the `sync-movies.js` file to fetch the all movie info
```
node sync-movies.js --input movies.txt --output movies.json --api-key __YOUR_API_KEY__
```
- Run the `download-posters.js` file to download the movie posters
```
node download-posters.js --input movies.json --output-dir posters
```
- Serve the `index.html` file & visit the page



### Assumptions:

- You have [node.js](https://nodejs.org/en/download) installed
- You can serve the `index.html` file

To serve:

```
npm install -g http-server
```

```
http-server .
```