docker build -t githttpservertest .
docker run -d -p 5000:5000 --name githttpservertest githttpservertest
sleep 1
curl --fail http://localhost:5000
RESULT=$?
docker container kill githttpservertest
docker container rm githttpservertest
exit $RESULT