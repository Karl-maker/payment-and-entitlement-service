export function snsWrap(message: unknown) {
  return {
    Type: "Notification",
    MessageId: `sns-${Date.now()}`,
    TopicArn: "arn:aws:sns:us-east-1:000000000000:billing-events-test",
    Message: JSON.stringify(message),
    Timestamp: new Date().toISOString(),
  };
}
