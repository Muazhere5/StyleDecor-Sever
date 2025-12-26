const fs = require("fs");

const key = require("./privatekey.json");

console.log(
  key.private_key.replace(/\n/g, "\\n")
);
