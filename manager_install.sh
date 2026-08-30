#! /bin/bash

cd argws-connect-manager-v2
npm install
npm run build
cd ..
rm -rf manager/dist
cp -r argws-connect-manager-v2/dist manager/dist