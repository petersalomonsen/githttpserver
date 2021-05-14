GIT http server
===============

A simple git http server deployable to [kubernetes](https://kubernetes.io), made for demonstration of the [WASM-git](http://github.com/petersalomonsen/wasm-git) project.

Even though WASM-git can clone git repositories from any git http server, there are restrictions in browsers when it comes to accessing data from other domains ([CORS](https://en.wikipedia.org/wiki/Cross-origin_resource_sharing)). This project is set up to provide a git server without this restriction.

For authentication and access control the [near-protocol](https://near.org) blockchain is used. Currently set up for the testnet, where new accounts are loaded with free gas from the beginning. Smart contract sources can be found in the [nearcontract](nearcontract) folder, and is for access control to repositories.

From the browser side a token is created and signed using the private keys stored in the browser. The server checks the signature and query the smart contract for access rights to the requested repository.