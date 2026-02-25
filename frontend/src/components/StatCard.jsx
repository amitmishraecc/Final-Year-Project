import { Card, CardContent, Typography } from "@mui/material";

function StatCard({ label, value, accent = "text.primary" }) {
  return (
    <Card
      variant="outlined"
      className="soft-fade-up"
      sx={{
        height: "100%",
        background: "linear-gradient(165deg, #ffffff, #f6fbff)",
        transition: "transform 180ms ease, box-shadow 180ms ease",
        "&:hover": {
          transform: "translateY(-2px)",
          boxShadow: "0 12px 28px rgba(17,82,147,0.14)",
        },
      }}
    >
      <CardContent>
        <Typography color="text.secondary" sx={{ fontWeight: 600, fontSize: 13 }}>
          {label}
        </Typography>
        <Typography variant="h5" sx={{ color: accent, mt: 0.7, fontWeight: 700 }}>
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}

export default StatCard;
